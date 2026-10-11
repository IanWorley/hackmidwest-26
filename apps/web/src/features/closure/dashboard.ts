import type { Standing } from "@/features/map/load-map";
import { DECISION_STATUSES } from "./decision-status";

/** A recommendation exists and nobody has settled it: no decision yet, a deferral, or a missed deadline. */
export function needsDecision(standing: Standing): boolean {
  return (
    standing.posture !== "not_evaluated" &&
    (standing.decision === null ||
      DECISION_STATUSES[standing.decision.action].awaitsDecision)
  );
}
