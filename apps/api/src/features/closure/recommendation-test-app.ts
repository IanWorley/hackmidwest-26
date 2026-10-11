import { recommendations } from "@hackmidwest/db";
import type { DatabaseStore } from "@hackmidwest/db/connection";
import { Effect } from "effect";
import { createApp } from "../../app";
import { makeNwpsClient } from "../../clients/nwps";
import type { NwsClientShape } from "../../clients/nws";
import type { OpenMeteoClientShape } from "../../clients/open-meteo";
import { createApiRuntime } from "../../runtime";
import type { EngineInput } from "./engine";
import { alert, forecastPeriod, STORM_ALL_DAY } from "./engine-test-fixtures";
import { recommendationHash } from "./recommendation-store";
import type { JsonValue } from "./records";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const KANSAS_CITY_ID = 1;
const UNKNOWN_ID = 999;
const EVALUATE_PATH = `/api/facilities/${KANSAS_CITY_ID}/recommendations`;
const LATEST_PATH = `${EVALUATE_PATH}/latest`;
const CLOCK = "2026-01-14T09:30:00.000Z";
const AS_OF = "2026-01-14T09:00:00.000Z";
const LATER_AS_OF = "2026-01-14T10:00:00.000Z";
const OBSERVATION_URL =
  "https://api.weather.gov/stations/KMKC/observations/2026-01-14T08:30:00+00:00";
const FORECAST_URL =
  "https://api.weather.gov/gridpoints/EAX/44,51/forecast/hourly";
const AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const CALM_GUST_KMH = 20;
const CLEAN_AQI = 40;
const NO_VALUE = { value: null, unitCode: "wmoUnit:km_h-1" };

const WINTER_STORM = alert("Winter Storm Warning", "Severe", STORM_ALL_DAY);
const CALM_HOUR = forecastPeriod(
  "2026-01-14T13:00:00Z",
  "2026-01-14T14:00:00Z",
  "10 mph",
);
const FORECAST = {
  rawRef: FORECAST_URL,
  updateTime: "2026-01-14T08:00:00Z",
  periods: [CALM_HOUR],
};

const stormNws: NwsClientShape = {
  activeAlerts: () => Effect.succeed([WINTER_STORM]),
  forecast: () => Effect.succeed(FORECAST),
  hourlyForecast: () => Effect.succeed(FORECAST),
  latestObservation: () =>
    Effect.succeed({
      stationId: "KMKC",
      timestamp: "2026-01-14T08:30:00Z",
      rawRef: OBSERVATION_URL,
      temperature: { value: null, unitCode: "wmoUnit:degC" },
      windSpeed: NO_VALUE,
      windGust: { value: CALM_GUST_KMH, unitCode: "wmoUnit:km_h-1" },
      visibility: { value: null, unitCode: "wmoUnit:m" },
    }),
};

const cleanAir: OpenMeteoClientShape = {
  currentAqi: () =>
    Effect.succeed({
      aqi: CLEAN_AQI,
      observedAt: "2026-01-14T08:00:00.000Z",
      rawRef: AQI_URL,
    }),
};

const EXPECTED_INPUT: EngineInput = {
  now: AS_OF,
  facility: {
    timezone: "America/Chicago",
    opensAt: "07:30",
    closesAt: "16:30",
    arrivalWindowStart: "06:30",
    arrivalWindowEnd: "09:00",
    typicalCommuteMinutes: 35,
    roadClass: "superCommuter",
    decisionDeadline: "05:00",
    hazardProfile: ["winter", "wind", "airQuality", "flood"],
  },
  readings: [
    {
      source: "nws",
      observedAt: "2026-01-14T08:30:00Z",
      metric: "windGust",
      value: CALM_GUST_KMH,
      unit: "km/h",
      rawRef: OBSERVATION_URL,
    },
    {
      source: "open-meteo",
      observedAt: "2026-01-14T08:00:00.000Z",
      metric: "aqi",
      value: CLEAN_AQI,
      unit: "AQI",
      rawRef: AQI_URL,
    },
  ],
  alerts: [WINTER_STORM],
  forecast: FORECAST,
};

interface TestApp {
  readonly get: (path: string) => Promise<Response>;
  readonly post: (path: string, body?: object) => Promise<Response>;
  readonly insertRow: (snapshot: object) => Promise<number>;
}

function jsonBody(body: object | undefined): string | null {
  if (body === undefined) {
    return null;
  }
  return JSON.stringify(body);
}

async function withStormAppOn(
  openStore: () => Promise<DatabaseStore>,
  run: (app: TestApp) => Promise<void>,
): Promise<void> {
  const store = await openStore();
  const runtime = createApiRuntime(store.db, {
    nws: stormNws,
    nwps: makeNwpsClient(),
    openMeteo: cleanAir,
  });
  const app = createApp({
    runRequest: runtime.runRequest,
    webOrigin: WEB_ORIGIN,
  });
  try {
    await run({
      get: (path) => app.handle(new Request(new URL(path, REQUEST_ORIGIN))),
      post: (path, body) =>
        app.handle(
          new Request(new URL(path, REQUEST_ORIGIN), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: jsonBody(body),
          }),
        ),
      insertRow: async (snapshot) => {
        // Engine interfaces lack an index signature, so the JSON round trip
        // is what lets an arbitrary snapshot be hashed as a JsonValue.
        const storedSnapshot: JsonValue = JSON.parse(JSON.stringify(snapshot));
        const content = {
          facilityId: KANSAS_CITY_ID,
          evaluatedAt: CLOCK,
          asOf: AS_OF,
          posture: "full_closure" as const,
          confidence: "high" as const,
          decideBy: "2026-01-14T11:00:00.000Z",
          snapshot: storedSnapshot,
        };
        const [row] = await store.db
          .insert(recommendations)
          .values({ ...content, contentHash: recommendationHash(content) })
          .returning({ id: recommendations.id });
        if (row === undefined) {
          throw new Error("insert returned no row");
        }
        return row.id;
      },
    });
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
}

export {
  AQI_URL,
  AS_OF,
  CLOCK,
  EVALUATE_PATH,
  EXPECTED_INPUT,
  FORECAST_URL,
  LATER_AS_OF,
  LATEST_PATH,
  OBSERVATION_URL,
  type TestApp,
  UNKNOWN_ID,
  WINTER_STORM,
  withStormAppOn,
};
