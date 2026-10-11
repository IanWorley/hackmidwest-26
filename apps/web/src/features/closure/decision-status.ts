import type {
  Decision,
  DecisionAction,
  EvaluatedStanding,
  Posture,
} from "@/features/map/load-map";

interface DecisionStatus {
  readonly label: string;
  /** Nobody has settled the facility yet, so its deadline (or how overdue it is) stays shown. */
  readonly awaitsDecision: boolean;
}

const DECISION_STATUSES: Record<DecisionAction, DecisionStatus> = {
  accept: { label: "Accepted", awaitsDecision: false },
  override: { label: "Overridden", awaitsDecision: false },
  defer: { label: "Deferred", awaitsDecision: true },
  no_decision: { label: "Missed decision", awaitsDecision: true },
};

/** The current decision's chosen posture once accepted or overridden; the recommendation's otherwise. */
function effectivePosture(standing: EvaluatedStanding): Posture {
  return standing.currentDecision?.chosenPosture ?? standing.posture;
}

/** The current decision when it is about the shown recommendation; null while a re-evaluation still awaits its own. */
function decisionOnRecommendation(
  standing: EvaluatedStanding,
): Decision | null {
  const { currentDecision } = standing;
  if (currentDecision?.recommendationId !== standing.recommendationId) {
    return null;
  }
  return currentDecision;
}

/** Whether someone still has to decide on the shown recommendation, so its deadline stays shown. */
function awaitsDecision(standing: EvaluatedStanding): boolean {
  const decision = decisionOnRecommendation(standing);
  return decision === null || DECISION_STATUSES[decision.action].awaitsDecision;
}

/** A deferral promises to decide by its recheck time, which comes before the recommendation's own deadline. */
function decisionDeadline(standing: EvaluatedStanding): string {
  return decisionOnRecommendation(standing)?.recheckAt ?? standing.decideBy;
}

export {
  awaitsDecision,
  DECISION_STATUSES,
  decisionDeadline,
  effectivePosture,
};
