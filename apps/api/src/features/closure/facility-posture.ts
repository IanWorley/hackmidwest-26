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
    readonly timing: Pick<TimingResult, "timingCase" | "status">;
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

/** A delay capped into telework keeps its hours only in the timing case; delays are never clamped. */
function cappedDelay(timingCase: TimingCase): FacilityPosture | undefined {
  if (
    timingCase.kind === "delayWithinCap" ||
    timingCase.kind === "outlastsDelayCap"
  ) {
    return {
      posture: "delayed_arrival",
      delayMinutes: timingCase.delayHours * MINUTES_PER_HOUR,
    };
  }
  return undefined;
}

/** A finding's own status, which the engine clamps so a release is never before evaluation. */
function findingPosture(
  posture: TimedPosture,
  timing: PostureTimings["findings"][number]["timing"],
): FacilityPosture | undefined {
  if (timing.status.posture === posture) {
    return fromStatus(timing.status);
  }
  if (posture === "delayed_arrival") {
    return cappedDelay(timing.timingCase);
  }
  return undefined;
}

/** A longer delay or an earlier release asks more of staff, as the engine ranks them. */
function moreDisruptive(
  current: FacilityPosture | undefined,
  next: FacilityPosture,
): FacilityPosture {
  if (current === undefined) {
    return next;
  }
  if (
    current.posture === "delayed_arrival" &&
    next.posture === "delayed_arrival" &&
    next.delayMinutes > current.delayMinutes
  ) {
    return next;
  }
  if (
    current.posture === "early_dismissal" &&
    next.posture === "early_dismissal" &&
    Date.parse(next.releaseAt) < Date.parse(current.releaseAt)
  ) {
    return next;
  }
  return current;
}

/**
 * The recommendation's own status supplies the timing when it names the chosen posture. Otherwise
 * the most disruptive timing any finding gives the chosen posture supplies it, as when the engine
 * capped a long delay into telework and the decider overrode back to a delayed arrival.
 */
function timedPosture(
  posture: TimedPosture,
  recommendation: PostureTimings,
): DecidedPosture {
  if (recommendation.status.posture === posture) {
    return { kind: "decided", posture: fromStatus(recommendation.status) };
  }
  const timed = recommendation.findings
    .map((finding) => findingPosture(posture, finding.timing))
    .filter((found) => found !== undefined)
    .reduce<FacilityPosture | undefined>(moreDisruptive, undefined);
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
