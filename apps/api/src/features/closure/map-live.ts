import { Cache, type Duration, Effect, Exit, Option } from "effect";
import { t } from "elysia";
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
import { NwsClient, OpenMeteoClient } from "../../runtime";
import { currentAlerts } from "./hazard-window";

/** Alerts and AQI change over minutes, so a minute of reuse spares api.weather.gov on page refreshes without hiding a new warning for long. */
const LIVE_CONDITIONS_TTL: Duration.Input = "1 minute";
/** An outage costs one slow load per window instead of every load waiting out the retries. */
const UNAVAILABLE_CONDITIONS_TTL: Duration.Input = "15 seconds";
const LIVE_CONDITIONS_CACHE_CAPACITY = 4;
const LIVE_REQUEST_CONCURRENCY = 4;

const AqiSchema = t.Object({ value: t.Number(), observedAt: t.String() });

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

type Aqi = typeof AqiSchema.static;
type AlertFeature = typeof AlertFeatureSchema.static;
type AlertCollection = typeof AlertCollectionSchema.static;

interface LiveConditions {
  readonly alerts: AlertCollection;
  /** One entry per requested point, in the same order. */
  readonly aqi: readonly (Aqi | null)[];
}

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
  const areas = (yield* Effect.forEach(points, nws.activeAlertAreas, {
    concurrency: LIVE_REQUEST_CONCURRENCY,
  })).flat();
  const inForce = new Set(
    currentAlerts(areas.map(({ alert }) => alert)).map(({ id }) => id),
  );
  const features = yield* Effect.forEach(
    uniqueById(areas.filter(({ alert }) => inForce.has(alert.id))),
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

/** None when an upstream failed after its retries, so the standings still load without weather. */
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
  ).pipe(
    Effect.map(Option.some<LiveConditions>),
    Effect.catch((error) =>
      Effect.logWarning("Live conditions unavailable", error).pipe(
        Effect.as(Option.none<LiveConditions>()),
      ),
    ),
  );
});

function liveConditionsTimeToLive(
  exit: Exit.Exit<Option.Option<LiveConditions>>,
): Duration.Input {
  if (Exit.isSuccess(exit) && Option.isSome(exit.value)) {
    return LIVE_CONDITIONS_TTL;
  }
  return UNAVAILABLE_CONDITIONS_TTL;
}

/** Concurrent page loads share one pull, and a different facility set is a different entry. */
function makeLiveConditionsCache(): Cache.Cache<
  readonly GeoPoint[],
  Option.Option<LiveConditions>,
  never,
  NwsClient | OpenMeteoClient
> {
  return Effect.runSync(
    Cache.makeWith(liveConditions, {
      capacity: LIVE_CONDITIONS_CACHE_CAPACITY,
      timeToLive: liveConditionsTimeToLive,
      requireServicesAt: "lookup",
    }),
  );
}

export { AlertCollectionSchema, AqiSchema, makeLiveConditionsCache };
