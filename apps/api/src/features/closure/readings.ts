import { type Static, t } from "elysia";
import type { AirNowObservation } from "../../clients/airnow";
import type { NwsObservation } from "../../clients/nws-model";

const READING_SOURCES = ["nws", "airnow"] as const;
const OBSERVATION_METRICS = [
  "temperature",
  "windSpeed",
  "windGust",
  "visibility",
] as const;
const READING_METRICS = [...OBSERVATION_METRICS, "aqi"] as const;
const READING_UNITS = ["degC", "km/h", "m", "AQI"] as const;

type ReadingUnit = (typeof READING_UNITS)[number];

/** NWS observation unit codes we can normalize. Any other code is skipped, not guessed at. */
const READING_UNIT_BY_NWS_CODE: ReadonlyMap<string, ReadingUnit> = new Map([
  ["wmoUnit:degC", "degC"],
  ["wmoUnit:km_h-1", "km/h"],
  ["wmoUnit:m", "m"],
]);

const ReadingSchema = t.Object({
  source: t.UnionEnum(READING_SOURCES),
  observedAt: t.String(),
  metric: t.UnionEnum(READING_METRICS),
  value: t.Number(),
  unit: t.UnionEnum(READING_UNITS),
  /** The upstream record this reading came from. */
  rawRef: t.String(),
});

type Reading = Static<typeof ReadingSchema>;

function observationReadings(observation: NwsObservation): Reading[] {
  return OBSERVATION_METRICS.flatMap((metric) => {
    const { value, unitCode } = observation[metric];
    const unit = READING_UNIT_BY_NWS_CODE.get(unitCode);
    if (value === null || unit === undefined) {
      return [];
    }
    return [
      {
        source: "nws",
        observedAt: observation.timestamp,
        metric,
        value,
        unit,
        rawRef: observation.rawRef,
      },
    ];
  });
}

/** AQI thresholds apply whatever the pollutant, so each pollutant becomes one `aqi` reading. */
function airQualityReadings(
  observations: readonly AirNowObservation[],
): Reading[] {
  return observations.map((observation) => ({
    source: "airnow",
    observedAt: observation.observedAt,
    metric: "aqi",
    value: observation.aqi,
    unit: "AQI",
    rawRef: observation.rawRef,
  }));
}

export type { Reading };
export { airQualityReadings, observationReadings, ReadingSchema };
