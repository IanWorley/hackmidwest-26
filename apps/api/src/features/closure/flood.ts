import { Clock, Effect } from "effect";
import type {
  NwpsClientShape,
  NwpsError,
  NwpsGaugeId,
  RiverGauge,
} from "../../clients/nwps";
import type { GeoPoint, NwsAlert } from "../../clients/nws-model";
import { NwpsClient, NwsClient } from "../../runtime";
import { gaugeCrossing, withCurrentStages } from "./gauge-stages";
import { NWS_SEVERITIES, THRESHOLDS } from "./thresholds";

type FloodCutoffs = typeof THRESHOLDS.flood.cutoffs;
type FloodCutoffKey = keyof FloodCutoffs;

interface FloodSignals {
  /** Active alerts for the events a flood cutoff lists; other alerts are dropped. */
  readonly alerts: readonly NwsAlert[];
  /** Undefined when the facility has no gauge, so only alerts apply. */
  readonly gauge: RiverGauge | undefined;
}

const FLOOD_ALERT_EVENTS: ReadonlySet<string> = new Set(
  Object.values(THRESHOLDS.flood.cutoffs).flatMap((cutoff) => {
    if (cutoff.unit === "nws_severity") {
      return cutoff.events;
    }
    return [];
  }),
);

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

export type { FloodCutoffKey, FloodSignals };
export { crossedFloodCutoffs, pullFloodSignals };
