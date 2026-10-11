import { Clock, Effect } from "effect";
import type {
  FloodCategory,
  NwpsClientShape,
  NwpsError,
  NwpsGaugeId,
  RiverGauge,
  StageAt,
} from "../../clients/nwps";
import type { GeoPoint, NwsAlert } from "../../clients/nws-model";
import { NwpsClient, NwsClient } from "../../runtime";
import { NWS_SEVERITIES, THRESHOLDS } from "./thresholds";
import { TIMING_POLICY } from "./timing-policy";
import { MS_PER_MINUTE } from "./zoned-time";

type FloodCutoffs = typeof THRESHOLDS.flood.cutoffs;
type FloodCutoffKey = keyof FloodCutoffs;

interface FloodSignals {
  /** Active alerts for the events a flood cutoff lists; other alerts are dropped. */
  readonly alerts: readonly NwsAlert[];
  /** Undefined when the facility has no gauge, so only alerts apply. */
  readonly gauge: RiverGauge | undefined;
}

/** From the first stage at or above a category to the first point after the last one. `end` is undefined if still above at the forecast horizon. */
interface GaugeCrossing {
  readonly start: string;
  readonly end: string | undefined;
}

const FLOOD_ALERT_EVENTS: ReadonlySet<string> = new Set(
  Object.values(THRESHOLDS.flood.cutoffs).flatMap((cutoff) => {
    if (cutoff.unit === "nws_severity") {
      return cutoff.events;
    }
    return [];
  }),
);

const MAX_STAGE_AGE_MS =
  TIMING_POLICY.gaugeStageStaleMinutes.value * MS_PER_MINUTE;

function isCurrent(point: StageAt, nowMs: number): boolean {
  return Date.parse(point.validTime) >= nowMs - MAX_STAGE_AGE_MS;
}

function withCurrentStages(gauge: RiverGauge, nowMs: number): RiverGauge {
  const forecast = gauge.forecast.filter((point) => isCurrent(point, nowMs));
  if (gauge.observed === undefined || !isCurrent(gauge.observed, nowMs)) {
    return { ...gauge, observed: undefined, forecast };
  }
  return { ...gauge, forecast };
}

// Forecast points at or before the observation are older than it, so the observation replaces them.
function stageTimeline({ observed, forecast }: RiverGauge): readonly StageAt[] {
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
  gauge: RiverGauge,
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

function crosses(
  cutoff: FloodCutoffs[FloodCutoffKey],
  { alerts, gauge }: FloodSignals,
): boolean {
  switch (cutoff.unit) {
    case "nws_severity": {
      const minimum = NWS_SEVERITIES.indexOf(cutoff.value);
      const events: readonly string[] = cutoff.events;
      return alerts.some(
        (alert) =>
          events.includes(alert.event) &&
          NWS_SEVERITIES.indexOf(alert.severity) >= minimum,
      );
    }
    case "nws_flood_category":
      return (
        gauge !== undefined && gaugeCrossing(gauge, cutoff.value) !== undefined
      );
    default:
      return cutoff satisfies never;
  }
}

function crossedFloodCutoffs(
  signals: FloodSignals,
): Record<FloodCutoffKey, boolean> {
  const { warning, moderateFlood, majorFlood } = THRESHOLDS.flood.cutoffs;
  return {
    warning: crosses(warning, signals),
    moderateFlood: crosses(moderateFlood, signals),
    majorFlood: crosses(majorFlood, signals),
  };
}

function maybeGauge(
  nwps: NwpsClientShape,
  gaugeId: NwpsGaugeId | undefined,
): Effect.Effect<RiverGauge | undefined, NwpsError> {
  if (gaugeId === undefined) {
    return Effect.succeed(undefined);
  }
  return nwps.gauge(gaugeId);
}

const pullFloodSignals = Effect.fn("pullFloodSignals")(function* (
  point: GeoPoint,
  gaugeId: NwpsGaugeId | undefined,
) {
  const nws = yield* NwsClient;
  const nwps = yield* NwpsClient;
  const { alerts, gauge } = yield* Effect.all(
    { alerts: nws.activeAlerts(point), gauge: maybeGauge(nwps, gaugeId) },
    { concurrency: "unbounded" },
  );
  const nowMs = yield* Clock.currentTimeMillis;
  const signals: FloodSignals = {
    alerts: alerts.filter((alert) => FLOOD_ALERT_EVENTS.has(alert.event)),
    gauge: gauge && withCurrentStages(gauge, nowMs),
  };
  return signals;
});

export type { FloodCutoffKey, FloodSignals, GaugeCrossing };
export {
  crossedFloodCutoffs,
  gaugeCrossing,
  pullFloodSignals,
  withCurrentStages,
};
