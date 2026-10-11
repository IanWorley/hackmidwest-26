import type { DecisionAction, Posture } from "@hackmidwest/db";
import type { FacilityPosture } from "./effective-status";
import type { Recommendation } from "./recommendation";
import type { OpmStatus, TimingCase, TimingResult } from "./timing";

const MINUTES_PER_HOUR = 60;

type TimedPosture = "delayed_arrival" | "early_dismissal";

/**
 * What a decision means for the facility. A defer or a missed deadline sets no posture, and an
 * override to a timed posture the recommendation never timed has no delay or release to announce.
 */
type DecidedPosture =
  | { readonly kind: "decided"; readonly posture: FacilityPosture }
  | { readonly kind: "undecided"; readonly action: "defer" | "no_decision" }
  | { readonly kind: "untimed"; readonly posture: TimedPosture };

/** The recommendation fields a posture reads, so a stored snapshot's arrays fit as well as the engine's tuples. */
interface PostureTimings {
  readonly status: Recommendation["status"];
  readonly findings: readonly {
    readonly timing: Pick<TimingResult, "timingCase">;
  }[];
}

interface DecisionPostureFacts {
  readonly action: DecisionAction;
  /** Null exactly when the action is `defer` or `no_decision`. */
  readonly chosenPosture: Posture | null;
}

function fromStatus(status: OpmStatus): FacilityPosture {
  switch (status.posture) {
    case "delayed_arrival":
      return {
        posture: status.posture,
        delayMinutes: status.delayHours * MINUTES_PER_HOUR,
      };
    case "early_dismissal":
      return { posture: status.posture, releaseAt: status.departAt };
    default:
      return status;
  }
}

function fromTimingCase(
  posture: TimedPosture,
  timingCase: TimingCase,
): FacilityPosture | undefined {
  if (
    posture === "delayed_arrival" &&
    (timingCase.kind === "delayWithinCap" ||
      timingCase.kind === "outlastsDelayCap")
  ) {
    return { posture, delayMinutes: timingCase.delayHours * MINUTES_PER_HOUR };
  }
  if (
    posture === "early_dismissal" &&
    timingCase.kind === "startsDuringHours"
  ) {
    return { posture, releaseAt: timingCase.releaseAt };
  }
  return undefined;
}

/**
 * The recommendation's own status supplies the timing when it names the chosen posture. Otherwise
 * the first finding whose timing case carries a delay or release supplies it, as when the engine capped
 * a long delay into telework and the decider overrode back to a delayed arrival.
 */
function timedPosture(
  posture: TimedPosture,
  recommendation: PostureTimings,
): DecidedPosture {
  if (recommendation.status.posture === posture) {
    return { kind: "decided", posture: fromStatus(recommendation.status) };
  }
  const timed = recommendation.findings
    .map((finding) => fromTimingCase(posture, finding.timing.timingCase))
    .find((found) => found !== undefined);
  if (timed === undefined) {
    return { kind: "untimed", posture };
  }
  return { kind: "decided", posture: timed };
}

function postureOfDecision(
  decision: DecisionPostureFacts,
  recommendation: PostureTimings,
): DecidedPosture {
  if (decision.action === "defer" || decision.action === "no_decision") {
    return { kind: "undecided", action: decision.action };
  }
  const chosen = decision.chosenPosture ?? recommendation.status.posture;
  switch (chosen) {
    case "delayed_arrival":
    case "early_dismissal":
      return timedPosture(chosen, recommendation);
    default:
      return { kind: "decided", posture: { posture: chosen } };
  }
}

export type { DecidedPosture, DecisionPostureFacts, PostureTimings };
export { postureOfDecision };
