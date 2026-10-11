import type { DecisionAction, Standing } from "@/features/map/load-map";

/** Only these settle a facility; a deferral or a lapsed deadline still leaves it waiting on someone. */
const SETTLING_ACTIONS: ReadonlySet<DecisionAction> = new Set([
  "accept",
  "override",
]);

/** A recommendation exists and no one has accepted or overridden it yet. */
export function needsDecision(standing: Standing): boolean {
  return (
    standing.posture !== "not_evaluated" &&
    (standing.decision === null ||
      !SETTLING_ACTIONS.has(standing.decision.action))
  );
}
