import {
  FLOOD_CATEGORIES,
  type FloodCategory,
  type RiverGauge,
  type StageAt,
} from "../../clients/nwps";
import type { EngineInput } from "./engine-input";
import type { Signal } from "./signals";
import { TIMING_POLICY } from "./timing-policy";
import { type IsoInstant, MS_PER_MINUTE, parseInstant } from "./zoned-time";

/** The part of a gauge a crossing reads, so a stored engine input needs no lid or name. */
type GaugeStages = Pick<RiverGauge, "floodStagesFt" | "observed" | "forecast">;

/** From the first stage at or above a category to the first point after the last one. `end` is undefined if still above at the forecast horizon. */
interface GaugeCrossing {
  readonly start: string;
  readonly end: string | undefined;
}

const MAX_STAGE_AGE_MS =
  TIMING_POLICY.gaugeStageStaleMinutes.value * MS_PER_MINUTE;

function isCurrent(point: StageAt, nowMs: number): boolean {
  return Date.parse(point.validTime) >= nowMs - MAX_STAGE_AGE_MS;
}

function withCurrentStages<Gauge extends GaugeStages>(
  gauge: Gauge,
  nowMs: number,
): Gauge {
  const forecast = gauge.forecast.filter((point) => isCurrent(point, nowMs));
  if (gauge.observed === undefined || !isCurrent(gauge.observed, nowMs)) {
    return { ...gauge, observed: undefined, forecast };
  }
  return { ...gauge, forecast };
}

// Forecast points at or before the observation are older than it, so the observation replaces them.
function stageTimeline({
  observed,
  forecast,
}: GaugeStages): readonly StageAt[] {
  if (observed === undefined) {
    return forecast;
  }
  const observedAt = Date.parse(observed.validTime);
  return [
    observed,
    ...forecast.filter((point) => Date.parse(point.validTime) > observedAt),
  ];
}

function gaugeCrossing(
  gauge: GaugeStages,
  category: FloodCategory,
): GaugeCrossing | undefined {
  const floodStageFt = gauge.floodStagesFt[category];
  if (floodStageFt === undefined) {
    return undefined;
  }
  const timeline = stageTimeline(gauge);
  const start = timeline.find((point) => point.stageFt >= floodStageFt);
  if (start === undefined) {
    return undefined;
  }
  // A dip below the stage followed by another crest is one flood, so the crossing ends after the last crest.
  const pointsAfterLastCrest = [...timeline]
    .reverse()
    .findIndex((point) => point.stageFt >= floodStageFt);
  if (pointsAfterLastCrest === 0) {
    return { start: start.validTime, end: undefined };
  }
  return {
    start: start.validTime,
    end: timeline.at(-pointsAfterLastCrest)?.validTime,
  };
}

/** One signal per flood category the river reaches. Stale stages are dropped first, as in the live pull. */
function gaugeSignals(gauge: EngineInput["gauge"], now: IsoInstant): Signal[] {
  if (gauge === null) {
    return [];
  }
  const stages = withCurrentStages(
    {
      floodStagesFt: gauge.floodStagesFt,
      observed: gauge.observed ?? undefined,
      forecast: gauge.forecast,
    },
    parseInstant(now),
  );
  return FLOOD_CATEGORIES.flatMap((category) =>
    categorySignal(stages, category, gauge),
  );
}

function categorySignal(
  stages: GaugeStages,
  category: FloodCategory,
  { rawRef, asOf }: NonNullable<EngineInput["gauge"]>,
): Signal[] {
  const floodStageFt = stages.floodStagesFt[category];
  const crossing = gaugeCrossing(stages, category);
  if (floodStageFt === undefined || crossing === undefined) {
    return [];
  }
  const start = parseInstant(crossing.start);
  let end = Number.POSITIVE_INFINITY;
  if (crossing.end !== undefined) {
    end = parseInstant(crossing.end);
  }
  const during = stageTimeline(stages).filter((point) => {
    const at = parseInstant(point.validTime);
    return at >= start && at <= end;
  });
  const last = during.at(-1);
  if (last === undefined) {
    return [];
  }
  return [
    {
      unit: "nws_flood_category",
      value: category,
      stageFt: Math.max(...during.map((point) => point.stageFt)),
      floodStageFt,
      origin: {
        source: "gauge",
        ref: rawRef,
        asOf,
        start: crossing.start,
        end: crossing.end ?? last.validTime,
      },
    },
  ];
}

export type { GaugeCrossing, GaugeStages };
export { gaugeCrossing, gaugeSignals, withCurrentStages };
