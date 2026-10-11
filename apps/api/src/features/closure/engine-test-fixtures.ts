import type { Hazard } from "@hackmidwest/db";
import type { ForecastPeriod, NwsAlert } from "../../clients/nws-model";
import type { EngineInput } from "./engine";
import type { Reading } from "./readings";
import type { OpmStatus } from "./timing";
import { FACILITY } from "./timing-test-fixtures";

const NOW = "2026-01-14T09:00:00Z";
const DURING_ARRIVAL = "2026-01-14T13:40:00Z";
const GUST_OBSERVED_DURING_ARRIVAL = "2026-01-14T13:30:00Z";
const DECISION_DEADLINE = "05:00";

const CALM_GUST_KMH = 20;
const AQI = {
  belowUnhealthy: 150,
  unhealthy: 151,
  smoky: 160,
  belowVeryUnhealthy: 200,
  veryUnhealthy: 201,
  hazardous: 300,
} as const;
const CLEAN_AQI = 40;
const KM_PER_MILE = 1.609_344;
const GUST_BELOW_CUTOFF_MPH = 57.9;
const GUST_AT_CUTOFF_MPH = 58;
const GUST_BELOW_CUTOFF_KMH = GUST_BELOW_CUTOFF_MPH * KM_PER_MILE;
const GUST_AT_CUTOFF_KMH = GUST_AT_CUTOFF_MPH * KM_PER_MILE;

type Window = readonly [start: string, end: string];

const STORM_ALL_DAY: Window = ["2026-01-14T06:00:00Z", "2026-01-15T03:00:00Z"];
const ENDS_0300_LOCAL: Window = [
  "2026-01-14T06:00:00Z",
  "2026-01-14T09:00:00Z",
];
const HAZARDS_ALL: readonly Hazard[] = ["winter", "wind", "airQuality"];

function forecastPeriod(
  startTime: string,
  endTime: string,
  windSpeed: string,
): ForecastPeriod {
  return {
    startTime,
    endTime,
    isDaytime: true,
    temperature: null,
    temperatureUnit: null,
    windSpeed,
    windDirection: null,
    shortForecast: null,
    probabilityOfPrecipitation: null,
  };
}

function gust(kmh: number, observedAt = "2026-01-14T08:30:00Z"): Reading {
  return {
    source: "nws",
    observedAt,
    metric: "windGust",
    value: kmh,
    unit: "km/h",
    rawRef: `obs-${observedAt}`,
  };
}

function aqi(value: number): Reading {
  return {
    source: "open-meteo",
    observedAt: "2026-01-14T08:00:00Z",
    metric: "aqi",
    value,
    unit: "AQI",
    rawRef: "aqi-0800",
  };
}

function alert(
  event: string,
  severity: NwsAlert["severity"],
  [start, end]: Window,
  endBasis: NwsAlert["hazardWindow"]["endBasis"] = "ends",
): NwsAlert {
  return {
    id: `${event}-${severity}-${start}`,
    event,
    headline: null,
    severity,
    certainty: "Likely",
    urgency: "Expected",
    messageType: "Alert",
    references: [],
    hazardWindow: { start, end, endBasis },
  };
}

const CALM_HOUR = forecastPeriod(
  "2026-01-14T13:00:00Z",
  "2026-01-14T14:00:00Z",
  "10 mph",
);

function forecastOf(
  periods: readonly ForecastPeriod[],
): EngineInput["forecast"] {
  return {
    rawRef: "forecast-hourly",
    updateTime: "2026-01-14T08:00:00Z",
    periods,
  };
}

function windAt(
  startTime: string,
  endTime: string,
  windSpeed: string,
): EngineInput["forecast"] {
  return forecastOf([CALM_HOUR, forecastPeriod(startTime, endTime, windSpeed)]);
}

function facility(
  hazardProfile: readonly Hazard[] = HAZARDS_ALL,
): EngineInput["facility"] {
  return { ...FACILITY, decisionDeadline: DECISION_DEADLINE, hazardProfile };
}

function engineInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    now: NOW,
    facility: facility(),
    readings: [gust(CALM_GUST_KMH), aqi(CLEAN_AQI)],
    alerts: [],
    forecast: forecastOf([CALM_HOUR]),
    ...overrides,
  };
}

function withAqi(value: number): EngineInput {
  return engineInput({ readings: [gust(CALM_GUST_KMH), aqi(value)] });
}

function withGustDuringArrival(kmh: number): EngineInput {
  return engineInput({
    now: DURING_ARRIVAL,
    readings: [gust(kmh, GUST_OBSERVED_DURING_ARRIVAL), aqi(CLEAN_AQI)],
  });
}

const ADVISORY_ENDS_0300 = alert(
  "Winter Weather Advisory",
  "Moderate",
  ENDS_0300_LOCAL,
);
const WIND_40_AT_1300 = windAt(
  "2026-01-14T19:00:00Z",
  "2026-01-14T20:00:00Z",
  "35 to 40 mph",
);
const EARLY_DISMISSAL_1145: OpmStatus = {
  posture: "early_dismissal",
  departAt: "2026-01-14T17:45:00.000Z",
  departAtLocal: "11:45",
};

export {
  ADVISORY_ENDS_0300,
  AQI,
  alert,
  aqi,
  CALM_GUST_KMH,
  CLEAN_AQI,
  DURING_ARRIVAL,
  EARLY_DISMISSAL_1145,
  ENDS_0300_LOCAL,
  engineInput,
  facility,
  forecastOf,
  forecastPeriod,
  GUST_AT_CUTOFF_KMH,
  GUST_BELOW_CUTOFF_KMH,
  GUST_OBSERVED_DURING_ARRIVAL,
  gust,
  STORM_ALL_DAY,
  WIND_40_AT_1300,
  windAt,
  withAqi,
  withGustDuringArrival,
};
