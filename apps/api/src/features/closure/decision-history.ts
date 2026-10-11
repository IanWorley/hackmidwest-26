import {
  decisionDirectives,
  decisions,
  facilities,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import { asc, desc, eq, getTableColumns } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import {
  CHAIN_RECORDS,
  DECISION_CHAIN_BREAK_REASONS,
  findChainBreaks,
} from "./decision-chain";
import { type HumanInputRow, toDecisionResponse } from "./decision-view";
import { parseDecimalId } from "./facilities";

const verifyResponse = t.Object({
  decisionId: t.Integer(),
  intact: t.Boolean(),
  breaks: t.Array(
    t.Object({
      record: t.UnionEnum(CHAIN_RECORDS),
      id: t.Integer(),
      reason: t.UnionEnum(DECISION_CHAIN_BREAK_REASONS),
    }),
  ),
});

class DecisionReadError extends Data.TaggedError("DecisionReadError")<{
  readonly operation: "history" | "verify";
  readonly cause: unknown;
}> {}

function groupByDecision(
  inputs: readonly HumanInputRow[],
): Map<number, HumanInputRow[]> {
  const grouped = new Map<number, HumanInputRow[]>();
  for (const input of inputs) {
    grouped.set(input.decisionId, [
      ...(grouped.get(input.decisionId) ?? []),
      input,
    ]);
  }
  return grouped;
}

/** Every decision for the facility, newest first, or none when no facility has the id. */
const listFacilityDecisions = Effect.fn("listFacilityDecisions")(function* (
  decimalId: string,
) {
  const facilityId = parseDecimalId(decimalId);
  if (Option.isNone(facilityId)) {
    return Option.none();
  }
  const db = yield* Database;
  const [facilityRows, decisionRows, inputRows] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select({ id: facilities.id })
          .from(facilities)
          .where(eq(facilities.id, facilityId.value)),
        db
          .select({ decision: decisions, decideBy: recommendations.decideBy })
          .from(decisions)
          .innerJoin(
            recommendations,
            eq(recommendations.id, decisions.recommendationId),
          )
          .where(eq(decisions.facilityId, facilityId.value))
          .orderBy(desc(decisions.id)),
        db
          .select(getTableColumns(humanInputs))
          .from(humanInputs)
          .innerJoin(decisions, eq(decisions.id, humanInputs.decisionId))
          .where(eq(decisions.facilityId, facilityId.value))
          .orderBy(asc(humanInputs.id)),
      ]),
    catch: (cause) => new DecisionReadError({ operation: "history", cause }),
  });
  if (facilityRows.length === 0) {
    return Option.none();
  }
  const inputsByDecision = groupByDecision(inputRows);
  return Option.some(
    decisionRows.map(({ decision, decideBy }) =>
      toDecisionResponse(
        decision,
        decideBy,
        inputsByDecision.get(decision.id) ?? [],
      ),
    ),
  );
});

/** The recommendation, its whole decision chain, and every dispatch of and directive on those decisions. */
const loadChain = Effect.fn("loadChain")(function* (recommendationId: number) {
  const db = yield* Database;
  const [[recommendation], chain, dispatches, directives] =
    yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select()
            .from(recommendations)
            .where(eq(recommendations.id, recommendationId)),
          db
            .select()
            .from(decisions)
            .where(eq(decisions.recommendationId, recommendationId))
            .orderBy(asc(decisions.id)),
          db
            .select(getTableColumns(notificationDispatches))
            .from(notificationDispatches)
            .innerJoin(
              decisions,
              eq(decisions.id, notificationDispatches.decisionId),
            )
            .where(eq(decisions.recommendationId, recommendationId))
            .orderBy(asc(notificationDispatches.id)),
          db
            .select(getTableColumns(decisionDirectives))
            .from(decisionDirectives)
            .innerJoin(
              decisions,
              eq(decisions.id, decisionDirectives.decisionId),
            )
            .where(eq(decisions.recommendationId, recommendationId))
            .orderBy(asc(decisionDirectives.id)),
        ]),
      catch: (cause) => new DecisionReadError({ operation: "verify", cause }),
    });
  if (recommendation === undefined) {
    return yield* Effect.die(
      new Error(`Recommendation ${recommendationId} is missing`),
    );
  }
  return { recommendation, decisions: chain, dispatches, directives };
});

const verifyDecision = Effect.fn("verifyDecision")(function* (
  decimalId: string,
) {
  const decisionId = parseDecimalId(decimalId);
  if (Option.isNone(decisionId)) {
    return Option.none();
  }
  const db = yield* Database;
  const [decision] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ recommendationId: decisions.recommendationId })
        .from(decisions)
        .where(eq(decisions.id, decisionId.value)),
    catch: (cause) => new DecisionReadError({ operation: "verify", cause }),
  });
  if (decision === undefined) {
    return Option.none();
  }
  const breaks = findChainBreaks(yield* loadChain(decision.recommendationId));
  return Option.some({
    decisionId: decisionId.value,
    intact: breaks.length === 0,
    breaks,
  });
});

export { listFacilityDecisions, verifyDecision, verifyResponse };
