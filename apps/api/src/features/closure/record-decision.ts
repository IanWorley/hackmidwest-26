import {
  DECISION_CHAIN_MOVED_MESSAGES,
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
import {
  type DecisionRow,
  type HumanInputRow,
  toDecisionResponse,
} from "./decision-view";
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

interface RecordedDecision {
  readonly decision: DecisionRow;
  readonly inputs: readonly HumanInputRow[];
}

/** Walks the error's cause chain, since drizzle wraps the driver error that carries the trigger message. */
function isChainMoved(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const { message } = error;
  return (
    DECISION_CHAIN_MOVED_MESSAGES.some((moved) => message.includes(moved)) ||
    isChainMoved(error.cause)
  );
}

/**
 * The decision and its human inputs land together or not at all. None when another decision
 * reached the chain between the caller's read and this insert, so the database is the last word
 * on staleness.
 */
const insertDecision = Effect.fn("insertDecision")(function* (
  content: DecisionContent,
  inputs: readonly HumanInputContent[],
) {
  const db = yield* Database;
  const written = yield* Effect.tryPromise({
    try: () =>
      db
        .transaction(async (tx): Promise<RecordedDecision> => {
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
        })
        .catch((error: unknown): undefined => {
          if (isChainMoved(error)) {
            return;
          }
          throw error;
        }),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
  return Option.fromNullishOr(written);
});

/** The 409 a request gets when it lost the race to extend the chain. */
const chainMovedConflict = Effect.fn("chainMovedConflict")(function* (
  recommendationId: number,
) {
  const db = yield* Database;
  const [newest] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: decisions.id })
        .from(decisions)
        .where(eq(decisions.recommendationId, recommendationId))
        .orderBy(desc(decisions.id))
        .limit(1),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
  return {
    kind: "conflict",
    conflict: {
      conflict: "newer_decision",
      latestDecisionId: newest?.id ?? null,
    },
  } satisfies DecisionOutcome;
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
  const recorded = yield* insertDecision(plan, body.humanInputs ?? []);
  if (Option.isNone(recorded)) {
    return yield* chainMovedConflict(context.value.recommendation.id);
  }
  const { decision, inputs } = recorded.value;
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
