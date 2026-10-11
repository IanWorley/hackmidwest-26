import type { EvaluatedStanding, Standing } from "@/features/map/load-map";

type UndecidedStanding = EvaluatedStanding & { decided: false };

/** A recommendation exists and no one has recorded a decision on it yet. */
export function needsDecision(
  standing: Standing,
): standing is UndecidedStanding {
  return standing.posture !== "not_evaluated" && !standing.decided;
}
