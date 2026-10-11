import type {
  DecisionAction,
  EvaluatedStanding,
  Posture,
} from "@/features/map/load-map";

interface DecisionStatus {
  readonly label: string;
  /** Whether the decide-by deadline still matters after this decision. */
  readonly awaitsDecision: boolean;
}

const DECISION_STATUSES: Record<DecisionAction, DecisionStatus> = {
  accept: { label: "Accepted", awaitsDecision: false },
  override: { label: "Overridden", awaitsDecision: false },
  defer: { label: "Deferred", awaitsDecision: true },
  no_decision: { label: "Missed decision", awaitsDecision: false },
};

/** The decision's chosen posture once accepted or overridden; the recommendation's otherwise. */
function effectivePosture(standing: EvaluatedStanding): Posture {
  return standing.decision?.chosenPosture ?? standing.posture;
}

export { DECISION_STATUSES, effectivePosture };
