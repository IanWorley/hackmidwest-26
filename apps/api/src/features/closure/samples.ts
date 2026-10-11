import type { ForecastPeriod } from "../../clients/nws-model";
import type { InputKind } from "./freshness";
import type { Period } from "./hazard-window";
import { byText, firstBy } from "./order";
import type { Reading } from "./readings";
import { TIMING_POLICY, type WindMetric } from "./thresholds";
import type { IsoInstant } from "./timing";
import { type Instant, parseInstant, shiftIso } from "./zoned-time";

const KM_PER_MILE = 1.609_344;
const FORECAST_WIND_PATTERN = /^(?:\d+ to )?(?<upperMph>\d+) mph$/u;

interface ForecastInput {
  readonly rawRef: string;
  readonly updateTime: IsoInstant;
  readonly periods: readonly ForecastPeriod[];
}

interface InputRef {
  readonly kind: InputKind | "alert";
  readonly source: Reading["source"];
  readonly ref: string;
  readonly asOf: IsoInstant;
}

interface Sample {
  readonly value: number;
  readonly period: Period;
  readonly input: InputRef;
}

interface SampleSources {
  readonly now: IsoInstant;
  readonly facilityDayEnd: Instant;
  readonly readings: readonly Reading[];
  readonly forecast: ForecastInput;
}

type NumericMetric = WindMetric | "aqi";

interface ReadingSampler {
  readonly metric: Reading["metric"];
  readonly toCutoffUnit: (value: number) => number;
  readonly holdsMinutes: number;
}

const GUST_SAMPLER: ReadingSampler = {
  metric: "windGust",
  toCutoffUnit: (kmh) => kmh / KM_PER_MILE,
  holdsMinutes: 0,
};

const AQI_SAMPLER: ReadingSampler = {
  metric: "aqi",
  toCutoffUnit: (aqi) => aqi,
  holdsMinutes: TIMING_POLICY.airQualityHoldMinutes.value,
};

const INPUT_KIND_BY_READING_SOURCE: Readonly<
  Record<Reading["source"], InputKind>
> = {
  nws: "observations",
  "open-meteo": "airQuality",
};

function samplesFor(metric: NumericMetric, sources: SampleSources): Sample[] {
  switch (metric) {
    case "wind_sustained":
      return forecastWindSamples(sources);
    case "wind_gust":
      return readingSamples(sources, GUST_SAMPLER);
    case "aqi":
      return readingSamples(sources, AQI_SAMPLER);
    default:
      return metric satisfies never;
  }
}

/** Like a reading, a forecast issued after `now` is ignored so an as-of replay never sees it. */
function forecastWindSamples({
  now,
  facilityDayEnd,
  forecast,
}: SampleSources): Sample[] {
  const nowAt = parseInstant(now);
  if (parseInstant(forecast.updateTime) > nowAt) {
    return [];
  }
  const input: InputRef = {
    kind: "forecast",
    source: "nws",
    ref: forecast.rawRef,
    asOf: forecast.updateTime,
  };
  return forecast.periods.flatMap(({ startTime, endTime, windSpeed }) => {
    const mph = forecastWindMph(windSpeed);
    const inFacilityDay =
      parseInstant(endTime) > nowAt && parseInstant(startTime) < facilityDayEnd;
    if (mph === undefined || !inFacilityDay) {
      return [];
    }
    return [{ value: mph, period: { startTime, endTime }, input }];
  });
}

function forecastWindMph(windSpeed: string | null): number | undefined {
  const upperMph = windSpeed?.match(FORECAST_WIND_PATTERN)?.groups?.upperMph;
  if (upperMph === undefined) {
    return undefined;
  }
  return Number(upperMph);
}

/** Readings stamped after `now` are ignored, so an as-of replay never sees the future. */
function readingSamples(
  { now, readings }: SampleSources,
  sampler: ReadingSampler,
): Sample[] {
  const nowAt = parseInstant(now);
  const latest = firstBy(
    readings.filter(
      (reading) =>
        reading.metric === sampler.metric &&
        parseInstant(reading.observedAt) <= nowAt,
    ),
    byLatest,
  );
  if (latest === undefined) {
    return [];
  }
  return [
    {
      value: sampler.toCutoffUnit(latest.value),
      period: {
        startTime: latest.observedAt,
        endTime: shiftIso(latest.observedAt, sampler.holdsMinutes),
      },
      input: {
        kind: INPUT_KIND_BY_READING_SOURCE[latest.source],
        source: latest.source,
        ref: latest.rawRef,
        asOf: latest.observedAt,
      },
    },
  ];
}

/** Overlapping or back-to-back periods form one hazard window; a gap starts another. */
function contiguousRuns<Item extends { readonly period: Period }>(
  items: readonly Item[],
): (readonly [Item, ...Item[]])[] {
  const sorted = [...items].sort(
    (left, right) =>
      parseInstant(left.period.startTime) -
      parseInstant(right.period.startTime),
  );
  const runs: [Item, ...Item[]][] = [];
  for (const item of sorted) {
    const run = runs.at(-1);
    const runEnd = Math.max(
      ...(run ?? []).map(({ period }) => parseInstant(period.endTime)),
    );
    if (run !== undefined && parseInstant(item.period.startTime) <= runEnd) {
      run.push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs;
}

/** Latest first; readings stamped at the same instant go larger value first, then by rawRef. */
function byLatest(left: Reading, right: Reading): number {
  return (
    parseInstant(right.observedAt) - parseInstant(left.observedAt) ||
    right.value - left.value ||
    byText(left.rawRef, right.rawRef)
  );
}

export type { ForecastInput, InputRef, NumericMetric, Sample, SampleSources };
export { contiguousRuns, samplesFor };
