import type { Hazard } from "@hackmidwest/db";
import type { NwsAlert } from "../../clients/nws-model";
import type { Recommendation } from "./engine";
import type { EngineInput } from "./engine-input";
import type { Reading } from "./readings";
import { FACILITY } from "./timing-test-fixtures";

// 2026-01-14 is CST (UTC-6): arrival opens 13:00Z, the facility closes 22:30Z, and the 05:00
// decision deadline is 11:00Z.
const NOW = "2026-01-14T09:00:00Z";
const OVERNIGHT_END = "2026-01-14T11:00:00Z";
const ALL_DAY_END = "2026-01-15T03:00:00Z";
const GUST_AT = "2026-01-14T12:30:00Z";
const AFTER_GUST = "2026-01-14T12:40:00Z";
const AQI_AT = "2026-01-14T10:00:00Z";
const AFTERNOON_HOUR = [
  "2026-01-14T19:00:00Z",
  "2026-01-14T20:00:00Z",
] as const;

/** KCDM7's stages, which defines no action stage. */
const FLOOD_STAGES_FT = { minor: 32, moderate: 35, major: 49 } as const;
const BELOW_MODERATE_FT = 33;
/** River crests relative to the KCDM7 stages above. */
const CREST_FT = {
  belowModerate: 34,
  justUnderModerate: 34.99,
  atModerate: 35,
  justUnderMajor: 48.99,
  atMajor: 49,
  pastMajor: 49.2,
} as const;
const RIVER_OBSERVED_AT = "2026-01-14T08:30:00Z";
const RIVER_CREST_AT = "2026-01-14T14:30:00Z";
const RIVER_FALLEN_AT = "2026-01-14T20:30:00Z";

/** NWS observations report wind in km/h; each value rounds to the mph in its name. */
const KMH = {
  mph12: 20,
  mph37: 60,
  mph45: 72.4,
  mph57: 91.7,
  mph58: 93.4,
  mph63: 101.4,
} as const;

const AQI_READING: Reading = {
  source: "open-meteo",
  observedAt: AQI_AT,
  metric: "aqi",
  value: 0,
  unit: "AQI",
  rawRef: "https://air-quality-api.open-meteo.com/v1/air-quality",
};

function input(
  hazards: readonly Hazard[],
  overrides: Partial<EngineInput> = {},
): EngineInput {
  return {
    now: NOW,
    facility: { ...FACILITY, decisionDeadline: "05:00", hazards: [...hazards] },
    alerts: { asOf: NOW, items: [] },
    readings: [],
    forecast: null,
    gauge: null,
    ...overrides,
  };
}

function alerts(...items: NwsAlert[]): EngineInput["alerts"] {
  return { asOf: NOW, items };
}

function nwsAlert(
  event: string,
  severity: NwsAlert["severity"],
  end: string = OVERNIGHT_END,
  endBasis: "ends" | "expires" = "ends",
): NwsAlert {
  return {
    id: `urn:oid:${event}`,
    event,
    headline: null,
    severity,
    certainty: "Likely",
    urgency: "Expected",
    messageType: "Alert",
    references: [],
    hazardWindow: { start: "2026-01-14T06:00:00Z", end, endBasis },
  };
}

function wind(
  metric: "windSpeed" | "windGust",
  kmh: number,
  observedAt: string,
): Reading {
  return {
    source: "nws",
    observedAt,
    metric,
    value: kmh,
    unit: "km/h",
    rawRef: "https://api.weather.gov/stations/KMKC/observations/1",
  };
}

function forecast(
  ...periods: readonly (readonly [string, string, string])[]
): EngineInput["forecast"] {
  return {
    asOf: "2026-01-14T08:00:00Z",
    rawRef: "https://api.weather.gov/gridpoints/EAX/44,51/forecast/hourly",
    periods: periods.map(([startTime, endTime, windSpeed]) => ({
      startTime,
      endTime,
      isDaytime: true,
      temperature: null,
      temperatureUnit: null,
      windSpeed,
      windDirection: null,
      shortForecast: null,
      probabilityOfPrecipitation: null,
    })),
  };
}

/** A river observed below moderate stage, forecast to crest at `crestFt` mid-morning and fall back by afternoon. */
function river(
  crestFt: number,
  observedAt: string = RIVER_OBSERVED_AT,
): EngineInput["gauge"] {
  return {
    rawRef: "https://api.water.noaa.gov/nwps/v1/gauges/KCDM7",
    asOf: NOW,
    floodStagesFt: FLOOD_STAGES_FT,
    observed: { stageFt: BELOW_MODERATE_FT, validTime: observedAt },
    forecast: [
      { stageFt: crestFt, validTime: RIVER_CREST_AT },
      { stageFt: BELOW_MODERATE_FT, validTime: RIVER_FALLEN_AT },
    ],
  };
}

/** `hazard/cutoffId` for each finding, most disruptive first. */
function crossed(recommendation: Recommendation): string[] {
  return recommendation.findings.map(
    (finding) => `${finding.hazard}/${finding.cutoffId}`,
  );
}

export {
  AFTER_GUST,
  AFTERNOON_HOUR,
  ALL_DAY_END,
  AQI_AT,
  AQI_READING,
  alerts,
  CREST_FT,
  crossed,
  forecast,
  GUST_AT,
  input,
  KMH,
  NOW,
  nwsAlert,
  OVERNIGHT_END,
  river,
  wind,
};
