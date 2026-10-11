import type { ConfidenceLevel, Hazard } from "@hackmidwest/db";
import type { Exceedance, Margin } from "./exceedances";
import type { InputKind, StaleInput } from "./freshness";
import type { EndBasis } from "./hazard-window";
import type { WindMetric } from "./thresholds";
import type { OpmStatus, TimingResult } from "./timing";
import type { IsoInstant } from "./zoned-time";

const MINUTES_PER_HOUR = 60;

interface Finding extends Exceedance {
  readonly timing: TimingResult;
}

type ConfidenceReason =
  | { readonly kind: "endBasis"; readonly endBasis: EndBasis }
  | ({ readonly kind: "stale" } & StaleInput)
  | { readonly kind: "missing"; readonly input: InputKind };

type Sensitivity =
  /** The deciding hazard moved by `shiftMinutes` (negative is earlier), other findings unchanged. */
  | {
      readonly kind: "onsetShift";
      readonly shiftMinutes: number;
      readonly status: OpmStatus;
    }
  /** The status if the deciding cutoff had not been crossed. Present only when it differs. */
  | {
      readonly kind: "withoutFinding";
      readonly hazard: Hazard;
      readonly cutoffId: string;
      readonly margin: Margin;
      readonly status: OpmStatus;
    };

/** Plain JSON, stored whole as the recommendation snapshot. */
interface Recommendation {
  /** The evaluation instant, `EngineInput.now`. */
  readonly asOf: IsoInstant;
  /** `YYYY-MM-DD` in the facility's zone: the day this decision is about. */
  readonly facilityDate: string;
  readonly status: OpmStatus;
  /** `YYYY-MM-DD` when a crossed hazard starts after today's close, else null. */
  readonly nextDay: string | null;
  readonly decideBy: {
    readonly at: IsoInstant;
    /** `HH:MM` on the facility's wall clock. */
    readonly local: string;
    readonly pastDeadline: boolean;
  };
  readonly confidence: {
    readonly level: ConfidenceLevel;
    readonly reasons: readonly ConfidenceReason[];
  };
  /** Every crossed cutoff, most disruptive timed status first. */
  readonly findings: readonly Finding[];
  /** Empty when nothing crossed. */
  readonly sensitivity: readonly Sensitivity[];
  readonly rationale: string;
}

function rationale(parts: Omit<Recommendation, "rationale">): string {
  return [
    opening(parts),
    alsoCrossed(parts.findings.slice(1)),
    deadline(parts.decideBy),
    `Confidence is ${parts.confidence.level}.`,
    ...parts.sensitivity.flatMap((what) => whatIf(what, parts.status)),
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
}

function opening({
  findings,
  status,
  facilityDate,
}: Omit<Recommendation, "rationale">): string {
  const [deciding] = findings;
  if (deciding === undefined) {
    return `No monitored hazard crosses a cutoff, so recommend ${statusPhrase(status)} on ${facilityDate}.`;
  }
  return `Recommend ${statusPhrase(status)} on ${facilityDate}: ${marginPhrase(deciding.margin)}.`;
}

function alsoCrossed(others: readonly Finding[]): string {
  if (others.length === 0) {
    return "";
  }
  const listed = others.map(
    (finding) =>
      `${marginPhrase(finding.margin)} (${statusPhrase(finding.timing.status)})`,
  );
  return `Also crossed: ${listed.join("; ")}.`;
}

function deadline({ local, pastDeadline }: Recommendation["decideBy"]): string {
  if (pastDeadline) {
    return `The ${local} decision deadline has passed.`;
  }
  return `Decide by ${local}.`;
}

function whatIf(sensitivity: Sensitivity, current: OpmStatus): string[] {
  switch (sensitivity.kind) {
    case "onsetShift": {
      const hours = Math.abs(sensitivity.shiftMinutes) / MINUTES_PER_HOUR;
      const condition = `If onset moves ${hours} hours ${direction(sensitivity.shiftMinutes)}`;
      const alternative = statusPhrase(sensitivity.status);
      if (alternative === statusPhrase(current)) {
        return [`${condition}, the recommendation holds.`];
      }
      return [`${condition}, this becomes ${alternative}.`];
    }
    case "withoutFinding":
      return [];
    default:
      return sensitivity satisfies never;
  }
}

function direction(shiftMinutes: number): "earlier" | "later" {
  if (shiftMinutes < 0) {
    return "earlier";
  }
  return "later";
}

function statusPhrase(status: OpmStatus): string {
  switch (status.posture) {
    case "normal":
      return "normal operations";
    case "delayed_arrival":
      return `a ${status.delayHours}-hour delayed arrival`;
    case "early_dismissal":
      return `early dismissal at ${status.departAtLocal}`;
    case "unscheduled_telework":
      return "unscheduled telework";
    case "full_closure":
      return "a full closure";
    default:
      return status satisfies never;
  }
}

function marginPhrase(margin: Margin): string {
  switch (margin.unit) {
    case "nws_severity":
      return `${margin.event} (${margin.observed}) vs ${margin.cutoff} severity cutoff, +${margin.by}`;
    case "mph":
      return `${metricLabel(margin.metric)} ${margin.observed} mph vs ${margin.cutoff} mph cutoff, +${margin.by}`;
    case "aqi":
      return `AQI ${margin.observed} vs ${margin.cutoff} cutoff, +${margin.by}`;
    default:
      return margin satisfies never;
  }
}

function metricLabel(metric: WindMetric): "sustained wind" | "gusts" {
  switch (metric) {
    case "wind_sustained":
      return "sustained wind";
    case "wind_gust":
      return "gusts";
    default:
      return metric satisfies never;
  }
}

export type { ConfidenceReason, Finding, Recommendation, Sensitivity };
export { rationale };
