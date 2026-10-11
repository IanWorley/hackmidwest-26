import { Effect } from "effect";
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

type FloodCutoffs = typeof THRESHOLDS.flood.cutoffs;
type FloodCutoffKey = keyof FloodCutoffs;

interface FloodSignals {
  /** Active alerts for the events a flood cutoff lists; other alerts are dropped. */
  readonly alerts: readonly NwsAlert[];
  /** Undefined when the facility has no gauge, so only alerts apply. */
  readonly gauge: RiverGauge | undefined;
}

/** When a gauge is at or above a category's stage. `end` is undefined if still above at the forecast horizon. */
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
  const end = timeline
    .slice(timeline.indexOf(start) + 1)
    .find((point) => point.stageFt < floodStageFt);
  return { start: start.validTime, end: end?.validTime };
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
  const signals: FloodSignals = {
    alerts: alerts.filter((alert) => FLOOD_ALERT_EVENTS.has(alert.event)),
    gauge,
  };
  return signals;
});

export type { FloodCutoffKey, FloodSignals, GaugeCrossing };
export { crossedFloodCutoffs, gaugeCrossing, pullFloodSignals };
