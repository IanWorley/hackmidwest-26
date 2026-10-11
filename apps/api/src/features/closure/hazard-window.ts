import type { ForecastPeriod, NwsAlert } from "../../clients/nws-model";
import {
  type Instant,
  MS_PER_MINUTE,
  parseInstant,
  toInstant,
} from "./zoned-time";

type EndBasis = NwsAlert["hazardWindow"]["endBasis"] | "forecast" | "reading";

type Period = Pick<ForecastPeriod, "startTime" | "endTime"> & {
  readonly endBasis: EndBasis;
};

/**
 * Where the hazard window comes from. The engine decides which forecast hours exceed its
 * threshold; timing reads only their times.
 */
type HazardEvidence =
  | {
      readonly source: "alert";
      readonly window: NwsAlert["hazardWindow"];
      readonly exceedingPeriods: readonly Period[];
    }
  | {
      readonly source: "forecast";
      readonly exceedingPeriods: readonly [Period, ...Period[]];
    };

interface Span {
  readonly start: Instant;
  readonly end: Instant;
  readonly endBasis: EndBasis;
}

interface HazardInterval extends Span {
  /** `end` plus the hazard's post-hazard buffer: when roads are expected to be usable again. */
  readonly clearsAt: Instant;
}

type MessageType = NwsAlert["messageType"];

const IN_FORCE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  "Alert",
  "Update",
]);
// Ack and Error also carry `references`, but they acknowledge or flag a message, not replace it.
const SUPERSEDING_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  "Update",
  "Cancel",
]);

/** Alerts still in force: Alerts and Updates that no Update or Cancel references. */
function currentAlerts(alerts: readonly NwsAlert[]): NwsAlert[] {
  const superseded = new Set(
    alerts
      .filter((alert) => SUPERSEDING_MESSAGE_TYPES.has(alert.messageType))
      .flatMap((alert) => alert.references),
  );
  return alerts.filter(
    (alert) =>
      IN_FORCE_MESSAGE_TYPES.has(alert.messageType) &&
      !superseded.has(alert.id),
  );
}

/**
 * The earliest start and latest end across the alert and the exceeding forecast hours. The
 * forecast can extend an alert, whose `expires` end often undershoots, but never shortens it.
 */
function hazardInterval(
  evidence: HazardEvidence,
  bufferMinutes: number,
): HazardInterval {
  const [first, ...rest] = evidenceSpans(evidence);
  const start = toInstant(
    Math.min(first.start, ...rest.map((span) => span.start)),
  );
  const last = rest.reduce(laterEnd, first);
  return {
    start,
    end: last.end,
    endBasis: last.endBasis,
    clearsAt: toInstant(last.end + bufferMinutes * MS_PER_MINUTE),
  };
}

function evidenceSpans(evidence: HazardEvidence): readonly [Span, ...Span[]] {
  if (evidence.source === "forecast") {
    const [head, ...tail] = evidence.exceedingPeriods;
    return [periodSpan(head), ...tail.map(periodSpan)];
  }
  const { window } = evidence;
  return [
    {
      start: parseInstant(window.start),
      end: parseInstant(window.end),
      endBasis: window.endBasis,
    },
    ...evidence.exceedingPeriods.map(periodSpan),
  ];
}

/** On a tie the earlier span keeps the end, so an alert's own end basis beats a forecast hour. */
function laterEnd(latest: Span, span: Span): Span {
  if (span.end > latest.end) {
    return span;
  }
  return latest;
}

function periodSpan(period: Period): Span {
  return {
    start: parseInstant(period.startTime),
    end: parseInstant(period.endTime),
    endBasis: period.endBasis,
  };
}

export type { EndBasis, HazardEvidence, HazardInterval };
export { currentAlerts, hazardInterval };
