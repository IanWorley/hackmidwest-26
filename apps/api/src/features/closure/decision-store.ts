import {
  decisionMakers,
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import { contentHash } from "./records";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

type DecisionRow = typeof decisions.$inferSelect;
type HumanInputRow = typeof humanInputs.$inferSelect;
type DispatchRow = typeof notificationDispatches.$inferSelect;
type DecisionMaker = typeof decisionMakers.$inferSelect;
type HumanInputContent = Pick<
  HumanInputRow,
  "reportedBy" | "reportedAt" | "text"
>;

/** Everything a decision's hash covers: every stored column plus the human inputs recorded with it. */
type DecisionContent = Omit<DecisionRow, "id" | "contentHash"> & {
  readonly humanInputs: readonly HumanInputContent[];
};
type DispatchContent = Omit<DispatchRow, "id" | "contentHash">;

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const HumanInputSchema = createSelectSchema(humanInputs);

const DecisionRecordSchema = t.Object({
  ...createSelectSchema(decisions).properties,
  humanInputs: t.Array(HumanInputSchema),
  decideBy: t.String(),
  /** Whole minutes from `decidedAt` to the recommendation's `decideBy`; negative when the decision came late. */
  minutesBeforeDecideBy: t.Integer(),
});

type DecisionRecord = typeof DecisionRecordSchema.static;

class DecisionStorageError extends Data.TaggedError("DecisionStorageError")<{
  readonly operation: "insert" | "decider" | "chainTip" | "history" | "chain";
  readonly cause: unknown;
}> {}

/** Hashes only the content columns and input fields, so a stored row with its stored inputs recomputes the hash its insert wrote. */
function decisionHash({
  recommendationId,
  recommendationHash,
  facilityId,
  action,
  chosenPosture,
  decidedById,
  decidedByName,
  decidedByRole,
  decidedAt,
  identityVerified,
  reasonCategory,
  reasonText,
  recheckAt,
  supersedesDecisionId,
  humanInputs: inputs,
}: DecisionContent): string {
  return contentHash({
    recommendationId,
    recommendationHash,
    facilityId,
    action,
    chosenPosture,
    decidedById,
    decidedByName,
    decidedByRole,
    decidedAt,
    identityVerified,
    reasonCategory,
    reasonText,
    recheckAt,
    supersedesDecisionId,
    humanInputs: inputs.map(
      ({ reportedBy, reportedAt, text }) =>
        ({ reportedBy, reportedAt, text }) satisfies HumanInputContent,
    ),
  } satisfies DecisionContent);
}

/** Hashes only the content columns, so a stored row recomputes the hash its insert wrote. */
function dispatchHash({
  decisionId,
  decisionHash: copiedDecisionHash,
  employeeId,
  channel,
  sendBy,
  recordedAt,
}: DispatchContent): string {
  return contentHash({
    decisionId,
    decisionHash: copiedDecisionHash,
    employeeId,
    channel,
    sendBy,
    recordedAt,
  } satisfies DispatchContent);
}

function recordOf(
  row: DecisionRow,
  inputs: readonly HumanInputRow[],
  decideBy: string,
): DecisionRecord {
  return {
    ...row,
    humanInputs: [...inputs],
    decideBy,
    minutesBeforeDecideBy: Math.floor(
      (parseInstant(decideBy) - parseInstant(row.decidedAt)) / MS_PER_MINUTE,
    ),
  };
}

function inputsByDecision(
  rows: readonly HumanInputRow[],
): Map<number, HumanInputRow[]> {
  const grouped = new Map<number, HumanInputRow[]>();
  for (const row of rows) {
    grouped.set(row.decisionId, [...(grouped.get(row.decisionId) ?? []), row]);
  }
  return grouped;
}

/** One batch, so a decision is never stored without the inputs its hash covers. */
const insertDecision = Effect.fn("insertDecision")(function* (
  { humanInputs: inputs, ...row }: DecisionContent,
  decideBy: string,
) {
  const db = yield* Database;
  const hash = decisionHash({ ...row, humanInputs: inputs });
  // The hash covers recommendation and predecessor, which the chain triggers make unique, so it names the new row.
  const insertedId = sql<number>`(select ${decisions.id} from ${decisions} where ${decisions.contentHash} = ${hash})`;
  const decisionInsert = db
    .insert(decisions)
    .values({ ...row, contentHash: hash })
    .returning();
  const [[decision], insertedInputs] = yield* Effect.tryPromise({
    try: async (): Promise<[DecisionRow[], HumanInputRow[]]> => {
      if (inputs.length === 0) {
        return [await decisionInsert, []];
      }
      return db.batch([
        decisionInsert,
        db
          .insert(humanInputs)
          .values(inputs.map((input) => ({ ...input, decisionId: insertedId })))
          .returning(),
      ]);
    },
    catch: (cause) => new DecisionStorageError({ operation: "insert", cause }),
  });
  if (decision === undefined) {
    return yield* Effect.die("insert returned no row");
  }
  return recordOf(decision, insertedInputs, decideBy);
});

const findDecider = Effect.fn("findDecider")(function* (id: number) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db.select().from(decisionMakers).where(eq(decisionMakers.id, id)),
    catch: (cause) => new DecisionStorageError({ operation: "decider", cause }),
  });
  return Option.fromNullishOr(row);
});

/** The newest decision on a recommendation; the chain triggers keep that chain linear, so it is the one to supersede. */
const findChainTip = Effect.fn("findChainTip")(function* (
  recommendationId: number,
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: decisions.id })
        .from(decisions)
        .where(eq(decisions.recommendationId, recommendationId))
        .orderBy(desc(decisions.id))
        .limit(1),
    catch: (cause) =>
      new DecisionStorageError({ operation: "chainTip", cause }),
  });
  return Option.fromNullishOr(row?.id);
});

/** Newest first. */
const facilityHistory = Effect.fn("facilityHistory")(function* (
  facilityId: number,
) {
  const db = yield* Database;
  const [rows, inputs] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select({
            decision: getTableColumns(decisions),
            decideBy: recommendations.decideBy,
          })
          .from(decisions)
          .innerJoin(
            recommendations,
            eq(recommendations.id, decisions.recommendationId),
          )
          .where(eq(decisions.facilityId, facilityId))
          .orderBy(desc(decisions.id)),
        db
          .select(getTableColumns(humanInputs))
          .from(humanInputs)
          .innerJoin(decisions, eq(decisions.id, humanInputs.decisionId))
          .where(eq(decisions.facilityId, facilityId))
          .orderBy(asc(humanInputs.id)),
      ]),
    catch: (cause) => new DecisionStorageError({ operation: "history", cause }),
  });
  const grouped = inputsByDecision(inputs);
  return rows.map(({ decision, decideBy }) =>
    recordOf(decision, grouped.get(decision.id) ?? [], decideBy),
  );
});

/** The recommendation behind a decision with every decision, input, and dispatch on its chain, oldest first. */
const loadChain = Effect.fn("loadChain")(function* (decisionId: number) {
  const db = yield* Database;
  const [decision] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ recommendationId: decisions.recommendationId })
        .from(decisions)
        .where(eq(decisions.id, decisionId)),
    catch: (cause) => new DecisionStorageError({ operation: "chain", cause }),
  });
  if (decision === undefined) {
    return Option.none();
  }
  const onChain = eq(decisions.recommendationId, decision.recommendationId);
  const [[recommendation], decisionRows, inputRows, dispatchRows] =
    yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select()
            .from(recommendations)
            .where(eq(recommendations.id, decision.recommendationId)),
          db.select().from(decisions).where(onChain).orderBy(asc(decisions.id)),
          db
            .select(getTableColumns(humanInputs))
            .from(humanInputs)
            .innerJoin(decisions, eq(decisions.id, humanInputs.decisionId))
            .where(onChain)
            .orderBy(asc(humanInputs.id)),
          db
            .select(getTableColumns(notificationDispatches))
            .from(notificationDispatches)
            .innerJoin(
              decisions,
              eq(decisions.id, notificationDispatches.decisionId),
            )
            .where(onChain)
            .orderBy(asc(notificationDispatches.id)),
        ]),
      catch: (cause) => new DecisionStorageError({ operation: "chain", cause }),
    });
  if (recommendation === undefined) {
    return yield* Effect.die("decision references a missing recommendation");
  }
  const grouped = inputsByDecision(inputRows);
  return Option.some({
    recommendation,
    decisions: decisionRows.map((row) => ({
      row,
      humanInputs: grouped.get(row.id) ?? [],
    })),
    dispatches: dispatchRows,
  });
});

export type { DecisionContent, DecisionMaker, DecisionRecord };
export {
  DecisionRecordSchema,
  decisionHash,
  dispatchHash,
  facilityHistory,
  findChainTip,
  findDecider,
  insertDecision,
  loadChain,
};
