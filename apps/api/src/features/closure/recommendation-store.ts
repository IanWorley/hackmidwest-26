import { HAZARDS, recommendations } from "@hackmidwest/db";
import { Value } from "@sinclair/typebox/value";
import { desc, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import type { RecordContent } from "./decision-chain";
import type { InputKind } from "./freshness";
import type { Reading } from "./readings";
import { type Snapshot, SnapshotSchema } from "./recommendation-snapshot";
import { type ContentHash, contentHash, type JsonValue } from "./records";
import { parseInstant } from "./zoned-time";

const MAX_SHAPE_ERRORS = 5;
const EVALUATION_MODES = ["live", "as_of"] as const;
const INSTANT_EVENTS = ["evaluated", "asOf", "decideBy"] as const;
const HAZARD_EVENTS = ["hazardStart", "hazardEnd", "roadsClear"] as const;
const TIMELINE_INPUTS = [
  "alerts",
  "observations",
  "forecast",
  "airQuality",
  "gauge",
] as const satisfies readonly ("alerts" | InputKind)[];

const READING_INPUT = {
  nws: "observations",
  "open-meteo": "airQuality",
} as const satisfies Record<Reading["source"], InputKind>;

type EvaluationMode = (typeof EVALUATION_MODES)[number];
type TimelineInput = (typeof TIMELINE_INPUTS)[number];
type RecommendationRow = typeof recommendations.$inferSelect;
type RecommendationContent = RecordContent<RecommendationRow>;

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const TimelineEntrySchema = t.Union([
  t.Object({ event: t.UnionEnum(INSTANT_EVENTS), at: t.String() }),
  t.Object({
    event: t.Literal("input"),
    at: t.String(),
    input: t.UnionEnum(TIMELINE_INPUTS),
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
  /** `as_of` when the request named an instant other than the clock reading, so it is never mistaken for a live call. */
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

/**
 * The one parser for a stored snapshot. It rejects any field the schema does not list, so nothing
 * is hashed that a reader cannot see. Throws a `TypeError` naming the first mismatches.
 */
function parseSnapshot(value: unknown): Snapshot {
  if (Value.Check(SnapshotSchema, value)) {
    return value;
  }
  const errors = [...Value.Errors(SnapshotSchema, value)]
    .slice(0, MAX_SHAPE_ERRORS)
    .map(({ path, message }) => `${path} ${message}`);
  throw new TypeError(
    `Snapshot does not match its schema: ${errors.join("; ")}`,
  );
}

/** Digests every column except `id` and `contentHash`, matching what `GET /api/decisions/:id/verify` recomputes. */
function recommendationHash({
  facilityId,
  evaluatedAt,
  asOf,
  posture,
  confidence,
  decideBy,
  snapshot,
}: Omit<RecommendationContent, "snapshot"> & {
  readonly snapshot: JsonValue;
}): ContentHash {
  return contentHash({
    facilityId,
    evaluatedAt,
    asOf,
    posture,
    confidence,
    decideBy,
    snapshot,
  });
}

function modeOf({ asOf, evaluatedAt }: RecommendationContent): EvaluationMode {
  if (asOf === evaluatedAt) {
    return "live";
  }
  return "as_of";
}

function inputEntries({ input }: Snapshot): TimelineEntry[] {
  const stamps: { readonly input: TimelineInput; readonly at: string }[] = [
    { input: "alerts", at: input.alerts.asOf },
    ...input.readings.map((reading) => ({
      input: READING_INPUT[reading.source],
      at: reading.observedAt,
    })),
  ];
  if (input.forecast !== null) {
    stamps.push({ input: "forecast", at: input.forecast.asOf });
  }
  if (input.gauge !== null) {
    stamps.push({
      input: "gauge",
      at: input.gauge.observed?.validTime ?? input.gauge.asOf,
    });
  }
  // One observation yields a reading per metric, all stamped alike.
  const unique = new Map(
    stamps.map((stamp) => [`${stamp.input} ${stamp.at}`, stamp]),
  );
  return [...unique.values()].map((stamp) => ({ event: "input", ...stamp }));
}

function hazardEntries({ output }: Snapshot): TimelineEntry[] {
  const [deciding] = output.findings;
  if (deciding === undefined) {
    return [];
  }
  const { hazard } = deciding;
  const { start, end, clearsAt } = deciding.timing.hazardWindow;
  return [
    { event: "hazardStart", at: start, hazard },
    { event: "hazardEnd", at: end, hazard },
    { event: "roadsClear", at: clearsAt, hazard },
  ];
}

/** Every instant the record rests on, earliest first: inputs, the deciding hazard's window, and the deadline. */
function timelineOf(
  row: RecommendationContent,
  snapshot: Snapshot,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { event: "evaluated", at: row.evaluatedAt },
    { event: "decideBy", at: row.decideBy },
    ...inputEntries(snapshot),
    ...hazardEntries(snapshot),
  ];
  if (modeOf(row) === "as_of") {
    entries.push({ event: "asOf", at: row.asOf });
  }
  return entries.sort(
    (left, right) => parseInstant(left.at) - parseInstant(right.at),
  );
}

function toRecord(row: RecommendationRow): RecommendationRecord {
  const snapshot = parseSnapshot(row.snapshot);
  return {
    ...row,
    snapshot,
    mode: modeOf(row),
    timeline: timelineOf(row, snapshot),
  };
}

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
    return yield* Effect.die("The recommendation insert returned no row");
  }
  return row;
});

const findRecommendation = Effect.fn("findRecommendation")(function* (
  id: number,
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db.select().from(recommendations).where(eq(recommendations.id, id)),
    catch: (cause) =>
      new RecommendationStorageError({ operation: "get", cause }),
  });
  return Option.fromNullishOr(row);
});

/** Rows are add-only and ids only grow, so the highest id is the latest evaluation. */
const findLatestRecommendation = Effect.fn("findLatestRecommendation")(
  function* (facilityId: number) {
    const db = yield* Database;
    const [row] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(recommendations)
          .where(eq(recommendations.facilityId, facilityId))
          .orderBy(desc(recommendations.id))
          .limit(1),
      catch: (cause) =>
        new RecommendationStorageError({ operation: "latest", cause }),
    });
    return Option.fromNullishOr(row);
  },
);

export type { Snapshot } from "./recommendation-snapshot";
export type { RecommendationRow };
export {
  findLatestRecommendation,
  findRecommendation,
  insertRecommendation,
  parseSnapshot,
  RecommendationRecordSchema,
  recommendationHash,
  toRecord,
};
