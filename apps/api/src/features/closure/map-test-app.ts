import { Effect } from "effect";
import { type NwsClientShape, NwsError } from "../../clients/nws";
import type { AreaGeometry, NwsAlertArea } from "../../clients/nws-model";
import { squareRing } from "../../clients/nws-test-client";
import type { ApiClients } from "../../runtime";
import { ALL_DAY_END, nwsAlert, OVERNIGHT_END } from "./engine-test-fixtures";

const ZONE_A_URL = "https://api.weather.gov/zones/forecast/MOZ037";
const ZONE_B_URL = "https://api.weather.gov/zones/forecast/MOZ038";
const ZONE_A_RING = squareRing({ lat: 39.0, lon: -94.7 });
const ZONE_B_RING = squareRing({ lat: 39.0, lon: -94.5 });
const STORM_RING = squareRing({ lat: 39.1, lon: -94.6 });

const ZONE_ALERT = nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END);
const STORM_ALERT = nwsAlert("Tornado Warning", "Extreme", OVERNIGHT_END);

const ZONE_GEOMETRY = new Map<string, AreaGeometry>([
  [ZONE_A_URL, { type: "Polygon", coordinates: [ZONE_A_RING] }],
  [ZONE_B_URL, { type: "MultiPolygon", coordinates: [[ZONE_B_RING]] }],
]);

const ZONE_AREA: NwsAlertArea = {
  alert: ZONE_ALERT,
  geometry: null,
  affectedZones: [ZONE_A_URL, ZONE_B_URL],
};
const STORM_AREA: NwsAlertArea = {
  alert: STORM_ALERT,
  geometry: { type: "Polygon", coordinates: [STORM_RING] },
  affectedZones: [ZONE_A_URL],
};

/** Every facility sees both alerts, so the map must report each once. */
const AREAS_AT_EVERY_POINT: NwsAlertArea[] = [ZONE_AREA, STORM_AREA];

const OBSERVED_AT = "2026-01-14T08:00:00.000Z";
const AQI = 40;
const AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

function notUsedByMap(): Effect.Effect<never> {
  return Effect.die(new Error("not used by /api/map"));
}

/** An Update that supersedes the storm alert, and a Cancel of an alert no facility sees, beside the zone alert. */
const SUPERSEDING_AREAS: NwsAlertArea[] = [
  ZONE_AREA,
  STORM_AREA,
  {
    alert: {
      ...nwsAlert("Tornado Warning", "Extreme", OVERNIGHT_END),
      id: "urn:oid:tornado-update",
      messageType: "Update",
      references: [STORM_ALERT.id],
    },
    geometry: { type: "Polygon", coordinates: [STORM_RING] },
    affectedZones: [],
  },
  {
    alert: {
      ...nwsAlert("Flood Watch", "Moderate", OVERNIGHT_END),
      id: "urn:oid:flood-cancel",
      messageType: "Cancel",
      references: ["urn:oid:flood-watch"],
    },
    geometry: { type: "Polygon", coordinates: [ZONE_A_RING] },
    affectedZones: [],
  },
];

const ALERTS_DOWN = new NwsError({
  url: "https://api.weather.gov/alerts/active",
  reason: { kind: "timeout" },
});

/** Map clients that count `activeAlertAreas` calls, to observe the live-conditions cache. */
function countingMapClients(
  areas: Effect.Effect<NwsAlertArea[], NwsError> = Effect.succeed(
    AREAS_AT_EVERY_POINT,
  ),
): {
  readonly clients: ApiClients;
  readonly alertAreaCalls: () => number;
} {
  let calls = 0;
  const nws: NwsClientShape = {
    activeAlerts: notUsedByMap,
    forecast: notUsedByMap,
    hourlyForecast: notUsedByMap,
    latestObservation: notUsedByMap,
    activeAlertAreas: () =>
      Effect.sync(() => {
        calls += 1;
      }).pipe(Effect.andThen(areas)),
    zoneGeometry: (zoneUrl) =>
      Effect.succeed(ZONE_GEOMETRY.get(zoneUrl) ?? null),
  };
  return {
    clients: {
      nws,
      nwps: { gauge: notUsedByMap },
      openMeteo: {
        currentAqi: () =>
          Effect.succeed({
            aqi: AQI,
            observedAt: OBSERVED_AT,
            rawRef: AQI_URL,
          }),
      },
    },
    alertAreaCalls: () => calls,
  };
}

export {
  ALERTS_DOWN,
  countingMapClients,
  STORM_ALERT,
  STORM_RING,
  SUPERSEDING_AREAS,
  ZONE_A_RING,
  ZONE_ALERT,
  ZONE_B_RING,
};
