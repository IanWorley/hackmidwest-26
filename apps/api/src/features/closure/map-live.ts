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
const LIVE_PULL_MESSAGE = "Pulling live conditions from NWS and Open-Meteo";

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

/**
 * Fetches each zone once, under one concurrency limit for the whole pull. A zone NWS cannot serve
 * has no outline, so its alert stays listed instead of failing every alert and AQI value.
 */
const zoneOutlines = Effect.fn("zoneOutlines")(function* (
  zoneUrls: readonly string[],
) {
  const nws = yield* NwsClient;
  const unique = [...new Set(zoneUrls)];
  const outlines = yield* Effect.forEach(
    unique,
    (zoneUrl) =>
      nws
        .zoneGeometry(zoneUrl)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Zone outline unavailable", error).pipe(
              Effect.as(null),
            ),
          ),
        ),
    { concurrency: LIVE_REQUEST_CONCURRENCY },
  );
  return new Map(
    unique.map((zoneUrl, index) => [zoneUrl, outlines[index] ?? null]),
  );
});

function zonesArea(
  zoneUrls: readonly string[],
  outlines: ReadonlyMap<string, AreaGeometry | null>,
): MultiPolygon | null {
  const polygons = zoneUrls.flatMap((zoneUrl) => {
    const outline = outlines.get(zoneUrl);
    if (outline === undefined || outline === null) {
      return [];
    }
    return polygonsOf(outline);
  });
  if (polygons.length === 0) {
    return null;
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function alertFeature(
  { alert, geometry, affectedZones }: NwsAlertArea,
  outlines: ReadonlyMap<string, AreaGeometry | null>,
): AlertFeature {
  return {
    type: "Feature",
    id: alert.id,
    geometry: geometry ?? zonesArea(affectedZones, outlines),
    properties: {
      event: alert.event,
      headline: alert.headline,
      severity: alert.severity,
      certainty: alert.certainty,
      urgency: alert.urgency,
      onset: alert.hazardWindow.start,
      ends: alert.hazardWindow.end,
    },
  };
}

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
  const current = uniqueById(
    areas.filter(({ alert }) => inForce.has(alert.id)),
  );
  const outlines = yield* zoneOutlines(
    current
      .filter(({ geometry }) => geometry === null)
      .flatMap(({ affectedZones }) => affectedZones),
  );
  const features = current.map((area) => alertFeature(area, outlines));
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
  // One line per upstream pull, so a reader of the API log can count cache misses.
  yield* Effect.logInfo(LIVE_PULL_MESSAGE);
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
