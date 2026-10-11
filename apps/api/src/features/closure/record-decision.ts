import {
  decisionMakers,
  decisions,
  humanInputs,
  recommendations,
} from "@hackmidwest/db";
import { desc, eq, max } from "drizzle-orm";
import { Data, DateTime, Effect, Option } from "effect";
import { Database } from "../../runtime";
import type { DecisionBody } from "./decision-body";
import {
  type DecisionContent,
  type DecisionContext,
  type DecisionOutcome,
  planDecision,
  RECOMMENDATION_NOT_FOUND,
} from "./decision-plan";
import { type HumanInputRow, toDecisionResponse } from "./decision-view";
import { parseDecimalId } from "./facilities";
import { contentHash } from "./records";

type HumanInputContent = Omit<typeof humanInputs.$inferInsert, "decisionId">;

class DecisionWriteError extends Data.TaggedError("DecisionWriteError")<{
  readonly cause: unknown;
}> {}

const loadDecisionContext = Effect.fn("loadDecisionContext")(function* (
  recommendationId: number,
  decidedById: number,
) {
  const db = yield* Database;
  const [[recommendation], [decider]] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select()
          .from(recommendations)
          .where(eq(recommendations.id, recommendationId)),
        db
          .select()
          .from(decisionMakers)
          .where(eq(decisionMakers.id, decidedById)),
      ]),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
  if (recommendation === undefined) {
    return Option.none<DecisionContext>();
  }
  const [[latestRecommendation], [newestDecision]] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select({ id: max(recommendations.id) })
          .from(recommendations)
          .where(eq(recommendations.facilityId, recommendation.facilityId)),
        db
          .select({ id: decisions.id })
          .from(decisions)
          .where(eq(decisions.recommendationId, recommendation.id))
          .orderBy(desc(decisions.id))
          .limit(1),
      ]),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
  return Option.some<DecisionContext>({
    recommendation,
    decider,
    // Rows are add-only and ids only grow, so the highest id is the latest evaluation.
    latestRecommendationId: latestRecommendation?.id ?? recommendation.id,
    latestDecisionId: newestDecision?.id ?? null,
  });
});

/** The decision and its human inputs land together or not at all. */
const insertDecision = Effect.fn("insertDecision")(function* (
  content: DecisionContent,
  inputs: readonly HumanInputContent[],
) {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [decision] = await tx
          .insert(decisions)
          .values({ ...content, contentHash: contentHash(content) })
          .returning();
        if (decision === undefined) {
          throw new Error("The decision insert returned no row");
        }
        const none: HumanInputRow[] = [];
        if (inputs.length === 0) {
          return { decision, inputs: none };
        }
        const recorded = await tx
          .insert(humanInputs)
          .values(
            inputs.map((input) => ({ ...input, decisionId: decision.id })),
          )
          .returning();
        return { decision, inputs: recorded };
      }),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
});

const recordDecision = Effect.fn("recordDecision")(function* (
  decimalId: string,
  body: DecisionBody,
) {
  const recommendationId = parseDecimalId(decimalId);
  if (Option.isNone(recommendationId)) {
    return RECOMMENDATION_NOT_FOUND;
  }
  const context = yield* loadDecisionContext(
    recommendationId.value,
    body.decidedById,
  );
  if (Option.isNone(context)) {
    return RECOMMENDATION_NOT_FOUND;
  }
  const plan = planDecision(body, context.value, yield* DateTime.now);
  if ("kind" in plan) {
    return plan;
  }
  const { decision, inputs } = yield* insertDecision(
    plan,
    body.humanInputs ?? [],
  );
  return {
    kind: "recorded",
    decision: toDecisionResponse(
      decision,
      context.value.recommendation.decideBy,
      inputs,
    ),
  } satisfies DecisionOutcome;
});

export { DecisionWriteError, insertDecision, recordDecision };
