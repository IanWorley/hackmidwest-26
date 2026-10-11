import type { Hazard } from "@hackmidwest/db";
import type { ForecastPeriod, NwsAlert } from "../../clients/nws-model";
import { THRESHOLDS } from "./thresholds";
import {
  type Instant,
  MS_PER_MINUTE,
  parseInstant,
  toInstant,
} from "./zoned-time";

type Period = Pick<ForecastPeriod, "startTime" | "endTime">;

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

type EndBasis = NwsAlert["hazardWindow"]["endBasis"] | "forecast";

interface Span {
  readonly start: Instant;
  readonly end: Instant;
  readonly endBasis: EndBasis;
}

interface HazardInterval extends Span {
  /** `end` plus the hazard's post-hazard buffer: when roads are expected to be usable again. */
  readonly clearsAt: Instant;
}

/**
 * Alerts still in force. An Update or Cancel names the alerts it replaces in `references`, so
 * any referenced alert is dropped, and so are Cancel, Ack, and Error messages themselves.
 */
function currentAlerts(alerts: readonly NwsAlert[]): NwsAlert[] {
  const superseded = new Set(alerts.flatMap((alert) => alert.references));
  return alerts.filter(
    (alert) =>
      (alert.messageType === "Alert" || alert.messageType === "Update") &&
      !superseded.has(alert.id),
  );
}

/**
 * The earliest start and latest end across the alert and the exceeding forecast hours. The
 * forecast can extend an alert, whose `expires` end often undershoots, but never shortens it.
 */
function hazardInterval(
  evidence: HazardEvidence,
  hazard: Hazard,
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
    clearsAt: toInstant(
      last.end +
        THRESHOLDS[hazard].postHazardBufferMinutes.value * MS_PER_MINUTE,
    ),
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
    endBasis: "forecast",
  };
}

export type { EndBasis, HazardEvidence, HazardInterval };
export { currentAlerts, hazardInterval };
