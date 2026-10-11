import { HAZARDS, recommendations } from "@hackmidwest/db";
import { desc, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import { parseDecimalId } from "../decimal-id";
import {
  parseAs,
  RecommendationSchema,
  type Snapshot,
  SnapshotSchema,
} from "./recommendation-schema";
import { contentHash } from "./records";
import { parseInstant } from "./zoned-time";

const EVALUATION_MODES = ["live", "as_of"] as const;
const INSTANT_EVENTS = ["evaluated", "asOf", "decideBy"] as const;
const HAZARD_EVENTS = ["hazardStart", "hazardEnd", "roadsClear"] as const;

type EvaluationMode = (typeof EVALUATION_MODES)[number];
type RecommendationRow = typeof recommendations.$inferSelect;
type RecommendationContent = Omit<RecommendationRow, "id" | "contentHash">;

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const TimelineEntrySchema = t.Union([
  t.Object({ event: t.UnionEnum(INSTANT_EVENTS), at: t.String() }),
  t.Object({
    event: t.Literal("input"),
    at: t.String(),
    input: RecommendationSchema.properties.inputs.items,
  }),
  t.Object({
    event: t.UnionEnum(HAZARD_EVENTS),
    at: t.String(),
    hazard: t.UnionEnum(HAZARDS),
  }),
]);

const RecommendationRecordSchema = t.Object({
  ...createSelectSchema(recommendations).properties,
  snapshot: SnapshotSchema,
  mode: t.UnionEnum(EVALUATION_MODES),
  timeline: t.Array(TimelineEntrySchema),
});

type TimelineEntry = typeof TimelineEntrySchema.static;
type RecommendationRecord = typeof RecommendationRecordSchema.static;

class RecommendationStorageError extends Data.TaggedError(
  "RecommendationStorageError",
)<{
  readonly operation: "insert" | "get" | "latest";
  readonly cause: unknown;
}> {}

function recommendationHash(content: RecommendationContent): string {
  return contentHash(content);
}

function modeOf({ asOf, evaluatedAt }: RecommendationContent): EvaluationMode {
  if (asOf === evaluatedAt) {
    return "live";
  }
  return "as_of";
}

function timelineOf(
  row: RecommendationContent,
  { output }: Snapshot,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { event: "evaluated", at: row.evaluatedAt },
    ...output.inputs.map(
      (input): TimelineEntry => ({ event: "input", at: input.asOf, input }),
    ),
    { event: "decideBy", at: row.decideBy },
  ];
  if (modeOf(row) === "as_of") {
    entries.push({ event: "asOf", at: row.asOf });
  }
  if (output.driver !== null) {
    const { hazard, timing } = output.driver;
    entries.push(
      { event: "hazardStart", at: timing.hazardWindow.start, hazard },
      { event: "hazardEnd", at: timing.hazardWindow.end, hazard },
      { event: "roadsClear", at: timing.hazardWindow.clearsAt, hazard },
    );
  }
  return entries.sort(
    (left, right) => parseInstant(left.at) - parseInstant(right.at),
  );
}

function recordOf(
  row: RecommendationRow,
  snapshot: Snapshot,
): RecommendationRecord {
  return {
    ...row,
    snapshot,
    mode: modeOf(row),
    timeline: timelineOf(row, snapshot),
  };
}

const toRecord = Effect.fn("toRecord")(function* (row: RecommendationRow) {
  return recordOf(row, yield* parseAs(SnapshotSchema, row.snapshot));
});

const insertRecommendation = Effect.fn("insertRecommendation")(function* (
  content: RecommendationContent & { readonly snapshot: Snapshot },
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .insert(recommendations)
        .values({ ...content, contentHash: recommendationHash(content) })
        .returning(),
    catch: (cause) =>
      new RecommendationStorageError({ operation: "insert", cause }),
  });
  if (row === undefined) {
    return yield* Effect.die("insert returned no row");
  }
  return recordOf(row, content.snapshot);
});

const findRecommendation = Effect.fn("findRecommendation")(function* (
  decimalId: string,
) {
  const id = parseDecimalId(decimalId);
  if (Option.isNone(id)) {
    return Option.none();
  }
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db.select().from(recommendations).where(eq(recommendations.id, id.value)),
    catch: (cause) =>
      new RecommendationStorageError({ operation: "get", cause }),
  });
  return Option.fromNullishOr(row);
});

const findLatestRecommendation = Effect.fn("findLatestRecommendation")(
  function* (decimalFacilityId: string) {
    const facilityId = parseDecimalId(decimalFacilityId);
    if (Option.isNone(facilityId)) {
      return Option.none();
    }
    const db = yield* Database;
    const [row] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(recommendations)
          .where(eq(recommendations.facilityId, facilityId.value))
          .orderBy(desc(recommendations.id))
          .limit(1),
      catch: (cause) =>
        new RecommendationStorageError({ operation: "latest", cause }),
    });
    return Option.fromNullishOr(row);
  },
);

export type { RecommendationRow };
export {
  findLatestRecommendation,
  findRecommendation,
  insertRecommendation,
  RecommendationRecordSchema,
  recommendationHash,
  toRecord,
};
