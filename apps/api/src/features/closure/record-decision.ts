import {
  type Database as DrizzleDatabase,
  decisionMakers,
  decisions,
  facilities,
  humanInputs,
  recommendations,
} from "@hackmidwest/db";
import { and, desc, eq, getTableColumns, or } from "drizzle-orm";
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
import { LIVE_RECOMMENDATION, NEWEST_FIRST } from "./recommendation-mode";
import { contentHash } from "./records";

type DecisionMakerRow = typeof decisionMakers.$inferSelect;
type HumanInputContent = Omit<typeof humanInputs.$inferInsert, "decisionId">;

class DecisionWriteError extends Data.TaggedError("DecisionWriteError")<{
  readonly cause: unknown;
}> {}

/** A transaction handle: every read and write of one decision goes through it. */
type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

interface RecordedDecision {
  readonly decision: DecisionRow;
  readonly inputs: readonly HumanInputRow[];
}

/** The decider only when they are the facility's decision maker or its backup. */
async function eligibleDecider(
  tx: Transaction,
  facilityId: number,
  decidedById: number,
): Promise<DecisionMakerRow | undefined> {
  const [decider] = await tx
    .select(getTableColumns(decisionMakers))
    .from(decisionMakers)
    .innerJoin(
      facilities,
      or(
        eq(facilities.decisionMakerId, decisionMakers.id),
        eq(facilities.backupDecisionMakerId, decisionMakers.id),
      ),
    )
    .where(
      and(eq(decisionMakers.id, decidedById), eq(facilities.id, facilityId)),
    );
  return decider;
}

async function loadDecisionContext(
  tx: Transaction,
  recommendationId: number,
  decidedById: number,
): Promise<DecisionContext | undefined> {
  const [recommendation] = await tx
    .select()
    .from(recommendations)
    .where(eq(recommendations.id, recommendationId));
  if (recommendation === undefined) {
    return undefined;
  }
  const [latestRecommendation] = await tx
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.facilityId, recommendation.facilityId),
        LIVE_RECOMMENDATION,
      ),
    )
    .orderBy(...NEWEST_FIRST)
    .limit(1);
  const [newestDecision] = await tx
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.recommendationId, recommendation.id))
    .orderBy(desc(decisions.id))
    .limit(1);
  return {
    recommendation,
    decider: await eligibleDecider(tx, recommendation.facilityId, decidedById),
    latestRecommendationId: latestRecommendation?.id ?? null,
    latestDecisionId: newestDecision?.id ?? null,
  };
}

/** Inserts the decision and its human inputs inside the caller's transaction. */
async function insertDecision(
  tx: Transaction,
  content: DecisionContent,
  inputs: readonly HumanInputContent[],
): Promise<RecordedDecision> {
  const [decision] = await tx
    .insert(decisions)
    .values({ ...content, contentHash: contentHash(content) })
    .returning();
  if (decision === undefined) {
    throw new Error("The decision insert returned no row");
  }
  if (inputs.length === 0) {
    return { decision, inputs: [] };
  }
  const recorded = await tx
    .insert(humanInputs)
    .values(inputs.map((input) => ({ ...input, decisionId: decision.id })))
    .returning();
  return { decision, inputs: recorded };
}

async function decideInTransaction(
  tx: Transaction,
  recommendationId: number,
  body: DecisionBody,
  decidedAt: DateTime.Utc,
): Promise<DecisionOutcome> {
  const context = await loadDecisionContext(
    tx,
    recommendationId,
    body.decidedById,
  );
  if (context === undefined) {
    return RECOMMENDATION_NOT_FOUND;
  }
  const plan = planDecision(body, context, decidedAt);
  if ("kind" in plan) {
    return plan;
  }
  const { decision, inputs } = await insertDecision(
    tx,
    plan,
    body.humanInputs ?? [],
  );
  return {
    kind: "recorded",
    decision: toDecisionResponse(
      decision,
      context.recommendation.decideBy,
      inputs,
    ),
  };
}

/**
 * The staleness checks and the insert share one write transaction. It begins IMMEDIATE, so no
 * other writer can add a recommendation or decision between the check and the insert.
 */
const recordDecision = Effect.fn("recordDecision")(function* (
  decimalId: string,
  body: DecisionBody,
) {
  const recommendationId = parseDecimalId(decimalId);
  if (Option.isNone(recommendationId)) {
    return RECOMMENDATION_NOT_FOUND;
  }
  const decidedAt = yield* DateTime.now;
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db.transaction((tx) =>
        decideInTransaction(tx, recommendationId.value, body, decidedAt),
      ),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
});

export type { Transaction };
export { DecisionWriteError, insertDecision, recordDecision };
