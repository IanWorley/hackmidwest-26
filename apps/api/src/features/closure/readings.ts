import { type Static, t } from "elysia";
import type { NwsObservation } from "../../clients/nws-model";
import type { AirQualityObservation } from "../../clients/open-meteo";

const READING_SOURCES = ["nws", "open-meteo"] as const;
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

const ReadingSchema = t.Object(
  {
    source: t.UnionEnum(READING_SOURCES),
    observedAt: t.String(),
    metric: t.UnionEnum(READING_METRICS),
    value: t.Number(),
    unit: t.UnionEnum(READING_UNITS),
    /** The upstream record this reading came from. */
    rawRef: t.String(),
  },
  { additionalProperties: false },
);

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

function airQualityReadings(
  observation: AirQualityObservation | undefined,
): Reading[] {
  if (observation === undefined) {
    return [];
  }
  return [
    {
      source: "open-meteo",
      observedAt: observation.observedAt,
      metric: "aqi",
      value: observation.aqi,
      unit: "AQI",
      rawRef: observation.rawRef,
    },
  ];
}

export type { Reading };
export { airQualityReadings, observationReadings, ReadingSchema };
