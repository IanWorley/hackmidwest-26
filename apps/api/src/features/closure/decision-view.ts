import { decisions, humanInputs } from "@hackmidwest/db";
import { createSchemaFactory } from "drizzle-typebox";
import { t } from "elysia";
import { MS_PER_MINUTE } from "./zoned-time";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

type DecisionRow = typeof decisions.$inferSelect;
type HumanInputRow = typeof humanInputs.$inferSelect;

const humanInputResponse = createSelectSchema(humanInputs);

/** A stored decision as the API returns it, with what is derived on read. */
const decisionResponse = t.Object({
  ...createSelectSchema(decisions).properties,
  minutesBeforeDecideBy: t.Integer(),
  humanInputs: t.Array(humanInputResponse),
});
type DecisionResponse = typeof decisionResponse.static;

/**
 * Whole minutes from decidedAt to decideBy, positive before the deadline. Floor, so a decision
 * any time after decideBy reads as negative and one within its final minute reads as 0.
 */
function minutesBeforeDecideBy(decidedAt: string, decideBy: string): number {
  return Math.floor(
    (Date.parse(decideBy) - Date.parse(decidedAt)) / MS_PER_MINUTE,
  );
}

function toDecisionResponse(
  decision: DecisionRow,
  decideBy: string,
  inputs: readonly HumanInputRow[],
): DecisionResponse {
  return {
    ...decision,
    minutesBeforeDecideBy: minutesBeforeDecideBy(decision.decidedAt, decideBy),
    humanInputs: [...inputs],
  };
}

export type { DecisionResponse, DecisionRow, HumanInputRow };
export { decisionResponse, toDecisionResponse };
