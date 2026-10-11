import { type Static, t } from "elysia";
import type { NwsObservation } from "../../clients/nws-model";

const READING_SOURCES = ["nws"] as const;
const READING_METRICS = [
  "temperature",
  "windSpeed",
  "windGust",
  "visibility",
] as const;
const READING_UNITS = ["degC", "km/h", "m"] as const;

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
  return READING_METRICS.flatMap((metric) => {
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

export type { Reading };
export { observationReadings, ReadingSchema };
