import { decisions, recommendations } from "@hackmidwest/db";
import type { DatabaseStore } from "@hackmidwest/db/connection";
import { asc } from "drizzle-orm";
import { type Clock, Effect } from "effect";
import { createApp } from "../../app";
import type { NwpsClientShape } from "../../clients/nwps";
import { KCDM7 } from "../../clients/nwps-test-client";
import type { NwsClientShape } from "../../clients/nws";
import type { OpenMeteoClientShape } from "../../clients/open-meteo";
import { createApiRuntime } from "../../runtime";
import type { EngineInput } from "./engine-input";
import { ALL_DAY_END, nwsAlert } from "./engine-test-fixtures";
import { recommendationHash } from "./recommendation-store";
import type { JsonValue } from "./records";

type Db = DatabaseStore["db"];
type DecisionRow = typeof decisions.$inferSelect;

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const NANOS_PER_MILLI = 1_000_000n;
const KANSAS_CITY_ID = 1;
const UNKNOWN_ID = 999;
const EVALUATE_PATH = `/api/facilities/${KANSAS_CITY_ID}/recommendations`;
const LATEST_PATH = `${EVALUATE_PATH}/latest`;
const CLOCK = "2026-01-14T09:30:00.000Z";
const AS_OF = "2026-01-14T09:00:00.000Z";
const LATER_AS_OF = "2026-01-14T10:00:00.000Z";
const DECIDE_BY = "2026-01-14T11:00:00.000Z";
const AFTER_DECIDE_BY = "2026-01-14T11:30:00.000Z";
const PULLED_AT = CLOCK;
const OBSERVED_AT = "2026-01-14T08:30:00Z";
const FORECAST_UPDATED_AT = "2026-01-14T08:00:00Z";
const AQI_AT = "2026-01-14T08:00:00.000Z";
const RIVER_AT = "2026-01-14T08:45:00Z";
const OBSERVATION_URL =
  "https://api.weather.gov/stations/KMKC/observations/2026-01-14T08:30:00+00:00";
const FORECAST_URL =
  "https://api.weather.gov/gridpoints/EAX/44,51/forecast/hourly";
const AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GAUGE_URL = "https://api.water.noaa.gov/nwps/v1/gauges/KCDM7";
const CALM_GUST_KMH = 20;
const CLEAN_AQI = 40;
const LOW_RIVER_FT = 15;
const KCDM7_STAGES_FT = { action: 29, minor: 32, moderate: 35, major: 49 };

const WINTER_STORM = nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END);
const CALM_HOUR = {
  startTime: "2026-01-14T13:00:00Z",
  endTime: "2026-01-14T14:00:00Z",
  isDaytime: true,
  temperature: null,
  temperatureUnit: null,
  windSpeed: "10 mph",
  windDirection: null,
  shortForecast: null,
  probabilityOfPrecipitation: null,
};
const FORECAST = {
  rawRef: FORECAST_URL,
  updateTime: FORECAST_UPDATED_AT,
  periods: [CALM_HOUR],
};
const LOW_RIVER = { stageFt: LOW_RIVER_FT, validTime: RIVER_AT };

const stormNws: NwsClientShape = {
  activeAlerts: () => Effect.succeed([WINTER_STORM]),
  forecast: () => Effect.succeed(FORECAST),
  hourlyForecast: () => Effect.succeed(FORECAST),
  latestObservation: () =>
    Effect.succeed({
      stationId: "KMKC",
      timestamp: OBSERVED_AT,
      rawRef: OBSERVATION_URL,
      temperature: { value: null, unitCode: "wmoUnit:degC" },
      windSpeed: { value: null, unitCode: "wmoUnit:km_h-1" },
      windGust: { value: CALM_GUST_KMH, unitCode: "wmoUnit:km_h-1" },
      visibility: { value: null, unitCode: "wmoUnit:m" },
    }),
};

const cleanAir: OpenMeteoClientShape = {
  currentAqi: () =>
    Effect.succeed({ aqi: CLEAN_AQI, observedAt: AQI_AT, rawRef: AQI_URL }),
};

const lowRiver: NwpsClientShape = {
  gauge: () =>
    Effect.succeed({
      lid: KCDM7,
      name: "Missouri River at Kansas City",
      rawRef: GAUGE_URL,
      floodStagesFt: KCDM7_STAGES_FT,
      observed: LOW_RIVER,
      forecast: [],
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
    hazards: ["winter", "wind", "airQuality", "flood"],
  },
  alerts: { asOf: PULLED_AT, items: [WINTER_STORM] },
  readings: [
    {
      source: "nws",
      observedAt: OBSERVED_AT,
      metric: "windGust",
      value: CALM_GUST_KMH,
      unit: "km/h",
      rawRef: OBSERVATION_URL,
    },
    {
      source: "open-meteo",
      observedAt: AQI_AT,
      metric: "aqi",
      value: CLEAN_AQI,
      unit: "AQI",
      rawRef: AQI_URL,
    },
  ],
  forecast: {
    asOf: FORECAST_UPDATED_AT,
    rawRef: FORECAST_URL,
    periods: [CALM_HOUR],
  },
  gauge: {
    rawRef: GAUGE_URL,
    asOf: PULLED_AT,
    floodStagesFt: KCDM7_STAGES_FT,
    observed: LOW_RIVER,
    forecast: [],
  },
};

interface TestApp {
  readonly db: Db;
  readonly get: (path: string) => Promise<Response>;
  readonly post: (path: string, body?: object) => Promise<Response>;
  readonly setClock: (at: string) => void;
  readonly insertUncheckedRow: (snapshot: JsonValue) => Promise<number>;
}

function settableClock(start: string): {
  readonly clock: Clock.Clock;
  readonly set: (at: string) => void;
} {
  let millis = Date.parse(start);
  function nanos(): bigint {
    return BigInt(millis) * NANOS_PER_MILLI;
  }
  return {
    clock: {
      currentTimeMillisUnsafe: () => millis,
      currentTimeMillis: Effect.sync(() => millis),
      currentTimeNanosUnsafe: nanos,
      currentTimeNanos: Effect.sync(nanos),
      monotonicTimeNanosUnsafe: nanos,
      monotonicTimeNanos: Effect.sync(nanos),
      sleep: () => Effect.void,
    },
    set: (at): void => {
      millis = Date.parse(at);
    },
  };
}

function requestFor(path: string, body: object | undefined): Request {
  const url = new URL(path, REQUEST_ORIGIN);
  if (body === undefined) {
    return new Request(url, { method: "POST" });
  }
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withStormAppOn(
  openStore: () => Promise<DatabaseStore>,
  run: (app: TestApp) => Promise<void>,
): Promise<void> {
  const store = await openStore();
  const { clock, set } = settableClock(CLOCK);
  const runtime = createApiRuntime(
    store.db,
    { nws: stormNws, openMeteo: cleanAir, nwps: lowRiver },
    { clock },
  );
  const app = createApp({
    runRequest: runtime.runRequest,
    webOrigin: WEB_ORIGIN,
  });
  try {
    await run({
      db: store.db,
      get: (path) => app.handle(new Request(new URL(path, REQUEST_ORIGIN))),
      post: (path, body) => app.handle(requestFor(path, body)),
      setClock: set,
      insertUncheckedRow: async (snapshot) => {
        const content = {
          facilityId: KANSAS_CITY_ID,
          evaluatedAt: CLOCK,
          asOf: AS_OF,
          posture: "full_closure" as const,
          confidence: "high" as const,
          decideBy: DECIDE_BY,
          snapshot,
        };
        const [row] = await store.db
          .insert(recommendations)
          .values({ ...content, contentHash: recommendationHash(content) })
          .returning({ id: recommendations.id });
        if (row === undefined) {
          throw new Error("The insert returned no row");
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

function storedDecisions(db: Db): Promise<DecisionRow[]> {
  return db.select().from(decisions).orderBy(asc(decisions.id)).all();
}

export {
  AFTER_DECIDE_BY,
  AQI_AT,
  AS_OF,
  CLOCK,
  DECIDE_BY,
  EVALUATE_PATH,
  EXPECTED_INPUT,
  FORECAST_UPDATED_AT,
  LATER_AS_OF,
  LATEST_PATH,
  OBSERVED_AT,
  RIVER_AT,
  storedDecisions,
  type TestApp,
  UNKNOWN_ID,
  WINTER_STORM,
  withStormAppOn,
};
