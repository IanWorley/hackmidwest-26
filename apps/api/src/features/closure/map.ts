import { decisions, facilities, recommendations } from "@hackmidwest/db";
import { asc, inArray, max } from "drizzle-orm";
import { Cache, Data, Duration, Effect, Exit } from "effect";
import { Elysia, t } from "elysia";
import type { NwsError } from "../../clients/nws";
import {
  AlertCertaintySchema,
  AlertSeveritySchema,
  AlertUrgencySchema,
  type AreaGeometry,
  AreaGeometrySchema,
  type GeoPoint,
  type MultiPolygon,
  NullableString,
  type NwsAlertArea,
} from "../../clients/nws-model";
import type { OpenMeteoError } from "../../clients/open-meteo";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  NwsClient,
  OpenMeteoClient,
  type RunRequest,
} from "../../runtime";
import { postureSchema } from "./postures";
import { LIVE_RECOMMENDATION } from "./recommendation-mode";

const MAP_PATH = "/api/map";
/** Alerts and AQI change over minutes, so a minute of reuse spares api.weather.gov on page refreshes without hiding a new warning for long. */
const LIVE_CONDITIONS_TTL = Duration.seconds(60);
const LIVE_CONDITIONS_CACHE_CAPACITY = 4;
const LIVE_REQUEST_CONCURRENCY = 4;

const AqiSchema = t.Object({ value: t.Number(), observedAt: t.String() });

const StandingSchema = t.Union([
  t.Object({ posture: t.Literal("not_evaluated") }),
  t.Object({
    posture: postureSchema,
    recommendationId: t.Integer(),
    decideBy: t.String(),
    /** When the evaluation ran, so a reader can judge how fresh the standing is. */
    asOf: t.String(),
    /** A decision row exists for this recommendation. */
    decided: t.Boolean(),
  }),
]);

const MapFacilitySchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  lat: t.Number(),
  lon: t.Number(),
  /** Live Open-Meteo US AQI, null where the model has no value for the point. */
  aqi: t.Union([AqiSchema, t.Null()]),
  standing: StandingSchema,
});

const AlertFeatureSchema = t.Object({
  type: t.Literal("Feature"),
  id: t.String(),
  /** Null only when NWS gave no inline geometry and none of the alert's zones had any. */
  geometry: t.Union([AreaGeometrySchema, t.Null()]),
  /** `onset` and `ends` are the alert's hazard window: onset else effective, ends else expires. */
  properties: t.Object({
    event: t.String(),
    headline: NullableString,
    severity: AlertSeveritySchema,
    certainty: AlertCertaintySchema,
    urgency: AlertUrgencySchema,
    onset: t.String(),
    ends: t.String(),
  }),
});

const AlertCollectionSchema = t.Object({
  type: t.Literal("FeatureCollection"),
  features: t.Array(AlertFeatureSchema),
});

const MapResponseSchema = t.Object({
  facilities: t.Array(MapFacilitySchema),
  alerts: AlertCollectionSchema,
});

type Aqi = typeof AqiSchema.static;
type Standing = typeof StandingSchema.static;
type AlertFeature = typeof AlertFeatureSchema.static;
type AlertCollection = typeof AlertCollectionSchema.static;

interface LiveConditions {
  readonly alerts: AlertCollection;
  /** One entry per requested point, in the same order. */
  readonly aqi: readonly (Aqi | null)[];
}

class MapStorageError extends Data.TaggedError("MapStorageError")<{
  readonly cause: unknown;
}> {}

function uniqueById(areas: readonly NwsAlertArea[]): NwsAlertArea[] {
  const byId = new Map<string, NwsAlertArea>();
  for (const area of areas) {
    if (!byId.has(area.alert.id)) {
      byId.set(area.alert.id, area);
    }
  }
  return [...byId.values()];
}

function polygonsOf(geometry: AreaGeometry): number[][][][] {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }
  return geometry.coordinates;
}

const zonesGeometry = Effect.fn("zonesGeometry")(function* (
  zoneUrls: readonly string[],
) {
  const nws = yield* NwsClient;
  const geometries = yield* Effect.forEach(zoneUrls, nws.zoneGeometry, {
    concurrency: LIVE_REQUEST_CONCURRENCY,
  });
  const polygons = geometries.flatMap((geometry) => {
    if (geometry === null) {
      return [];
    }
    return polygonsOf(geometry);
  });
  if (polygons.length === 0) {
    return null;
  }
  return { type: "MultiPolygon", coordinates: polygons } satisfies MultiPolygon;
});

const alertFeature = Effect.fn("alertFeature")(function* ({
  alert,
  geometry,
  affectedZones,
}: NwsAlertArea) {
  const area = geometry ?? (yield* zonesGeometry(affectedZones));
  return {
    type: "Feature",
    id: alert.id,
    geometry: area,
    properties: {
      event: alert.event,
      headline: alert.headline,
      severity: alert.severity,
      certainty: alert.certainty,
      urgency: alert.urgency,
      onset: alert.hazardWindow.start,
      ends: alert.hazardWindow.end,
    },
  } satisfies AlertFeature;
});

const alertCollection = Effect.fn("alertCollection")(function* (
  points: readonly GeoPoint[],
) {
  const nws = yield* NwsClient;
  const areas = yield* Effect.forEach(points, nws.activeAlertAreas, {
    concurrency: LIVE_REQUEST_CONCURRENCY,
  });
  const features = yield* Effect.forEach(
    uniqueById(areas.flat()),
    alertFeature,
    { concurrency: LIVE_REQUEST_CONCURRENCY },
  );
  return { type: "FeatureCollection", features } satisfies AlertCollection;
});

const currentAqi = Effect.fn("currentAqi")(function* (point: GeoPoint) {
  const openMeteo = yield* OpenMeteoClient;
  const observation = yield* openMeteo.currentAqi(point);
  if (observation === undefined) {
    return null;
  }
  return { value: observation.aqi, observedAt: observation.observedAt };
});

const liveConditions = Effect.fn("liveConditions")(function* (
  points: readonly GeoPoint[],
) {
  return yield* Effect.all(
    {
      alerts: alertCollection(points),
      aqi: Effect.forEach(points, currentAqi, {
        concurrency: LIVE_REQUEST_CONCURRENCY,
      }),
    },
    { concurrency: "unbounded" },
  );
});

function liveConditionsTimeToLive(
  exit: Exit.Exit<LiveConditions, NwsError | OpenMeteoError>,
): Duration.Duration {
  if (Exit.isSuccess(exit)) {
    return LIVE_CONDITIONS_TTL;
  }
  return Duration.zero;
}

/** Each facility's newest live recommendation, the one `findLatestRecommendation` returns and a decision is about, and whether it has a decision. Previews never become a standing. */
const readStandings = Effect.fn("readStandings")(function* () {
  const db = yield* Database;
  const latestIds = db
    .select({ id: max(recommendations.id) })
    .from(recommendations)
    .where(LIVE_RECOMMENDATION)
    .groupBy(recommendations.facilityId);
  const [facilityRows, latestRows, decidedRows] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select({
            id: facilities.id,
            name: facilities.name,
            lat: facilities.latitude,
            lon: facilities.longitude,
          })
          .from(facilities)
          .orderBy(asc(facilities.name)),
        db
          .select()
          .from(recommendations)
          .where(inArray(recommendations.id, latestIds)),
        db
          .selectDistinct({ recommendationId: decisions.recommendationId })
          .from(decisions)
          .where(inArray(decisions.recommendationId, latestIds)),
      ]),
    catch: (cause) => new MapStorageError({ cause }),
  });
  const decided = new Set(
    decidedRows.map(({ recommendationId }) => recommendationId),
  );
  const standings = new Map<number, Standing>(
    latestRows.map((row) => [
      row.facilityId,
      {
        posture: row.posture,
        recommendationId: row.id,
        decideBy: row.decideBy,
        asOf: row.asOf,
        decided: decided.has(row.id),
      },
    ]),
  );
  return facilityRows.map((facility) => ({
    ...facility,
    standing: standings.get(facility.id) ?? { posture: "not_evaluated" },
  }));
});

export function createMapModule(runRequest: RunRequest) {
  // Concurrent page loads share one pull; a different facility set is a different entry; failures are not kept.
  const liveConditionsCache = Effect.runSync(
    Cache.makeWith(liveConditions, {
      capacity: LIVE_CONDITIONS_CACHE_CAPACITY,
      timeToLive: liveConditionsTimeToLive,
      requireServicesAt: "lookup",
    }),
  );

  const mapRequest = Effect.fn("mapRequest")(function* () {
    const facilityStandings = yield* readStandings();
    const points = facilityStandings.map(({ lat, lon }) => ({ lat, lon }));
    const { alerts, aqi } = yield* Cache.get(liveConditionsCache, points);
    return {
      facilities: facilityStandings.map((facility, index) => ({
        ...facility,
        aqi: aqi[index] ?? null,
      })),
      alerts,
    };
  });

  return new Elysia({ name: "map" }).get(
    MAP_PATH,
    () => runRequest(mapRequest()),
    {
      response: {
        [HTTP_OK]: MapResponseSchema,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { MAP_PATH };
