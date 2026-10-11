import { recommendations } from "@hackmidwest/db";
import { eq } from "drizzle-orm";

const EVALUATION_MODES = ["live", "as_of"] as const;

type EvaluationMode = (typeof EVALUATION_MODES)[number];
type RecommendationInstants = Pick<
  typeof recommendations.$inferSelect,
  "asOf" | "evaluatedAt"
>;

/**
 * A recommendation is live when it was evaluated as of its own clock reading. Any other asOf is a
 * preview: it never becomes the facility's current recommendation and never enters a decision
 * chain. `modeOf` and `LIVE_RECOMMENDATION` are the same rule for a row and for a query.
 */
function modeOf({ asOf, evaluatedAt }: RecommendationInstants): EvaluationMode {
  if (asOf === evaluatedAt) {
    return "live";
  }
  return "as_of";
}

const LIVE_RECOMMENDATION = eq(
  recommendations.asOf,
  recommendations.evaluatedAt,
);

export { EVALUATION_MODES, LIVE_RECOMMENDATION, modeOf };
