import type {
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

/** The decision's chosen posture once accepted or overridden; the recommendation's otherwise. */
function effectivePosture(standing: EvaluatedStanding): Posture {
  return standing.decision?.chosenPosture ?? standing.posture;
}

/** A deferral promises to decide by its recheck time, which comes before the recommendation's own deadline. */
function decisionDeadline(standing: EvaluatedStanding): string {
  return standing.decision?.recheckAt ?? standing.decideBy;
}

export { DECISION_STATUSES, decisionDeadline, effectivePosture };
