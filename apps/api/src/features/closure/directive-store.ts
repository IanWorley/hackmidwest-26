import {
  buildings,
  type Database as DatabaseClient,
  DIRECTIVE_GROUPS,
  type DirectiveScope,
  decisionDirectives,
  decisions,
  employees,
  parseDirectiveScope,
} from "@hackmidwest/db";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import { parseDecimalId } from "../decimal-id";
import { contentHash } from "./records";

type DirectiveRow = typeof decisionDirectives.$inferSelect;
type DirectiveContent = Omit<DirectiveRow, "id" | "contentHash">;
/** A stored directive with its scope parsed; it satisfies the resolver's `Directive`. */
type DirectiveRecord = Omit<DirectiveRow, "scope"> & {
  readonly scope: DirectiveScope;
};

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const positiveId = t.Integer({ minimum: 1 });

const DirectiveScopeSchema = t.Union([
  t.Object({ kind: t.Literal("facility") }),
  t.Object({ kind: t.Literal("group"), group: t.UnionEnum(DIRECTIVE_GROUPS) }),
  t.Object({ kind: t.Literal("building"), buildingId: positiveId }),
  t.Object({ kind: t.Literal("employee"), employeeId: positiveId }),
]);

const DirectiveRecordSchema = t.Object({
  ...createSelectSchema(decisionDirectives).properties,
  scope: DirectiveScopeSchema,
});

class DirectiveStorageError extends Data.TaggedError("DirectiveStorageError")<{
  readonly operation: "decision" | "insert" | "list" | "chain" | "scope";
  readonly cause: unknown;
}> {}

function directiveHash({
  decisionId,
  decisionHash,
  scope,
  directive,
  effectiveAt,
  reasonCategory,
  reasonText,
  issuedById,
  issuedAt,
}: DirectiveContent): string {
  return contentHash({
    decisionId,
    decisionHash,
    scope,
    directive,
    effectiveAt,
    reasonCategory,
    reasonText,
    issuedById,
    issuedAt,
  } satisfies DirectiveContent);
}

/** The one place stored scope text becomes a typed scope. The scope CHECK admits only text this parses, so a miss means the table was written around it. */
function directiveRecordOf(row: DirectiveRow): DirectiveRecord {
  const scope = parseDirectiveScope(row.scope);
  if (scope === null) {
    throw new TypeError(
      `decision_directives row ${row.id} has an unreadable scope: ${row.scope}`,
    );
  }
  return { ...row, scope };
}

const insertDirective = Effect.fn("insertDirective")(function* (
  content: DirectiveContent,
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .insert(decisionDirectives)
        .values({ ...content, contentHash: directiveHash(content) })
        .returning(),
    catch: (cause) => new DirectiveStorageError({ operation: "insert", cause }),
  });
  if (row === undefined) {
    return yield* Effect.die("insert returned no row");
  }
  return directiveRecordOf(row);
});

const listDirectives = Effect.fn("listDirectives")(function* (
  decisionId: number,
) {
  const db = yield* Database;
  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(decisionDirectives)
        .where(eq(decisionDirectives.decisionId, decisionId))
        .orderBy(asc(decisionDirectives.id)),
    catch: (cause) => new DirectiveStorageError({ operation: "list", cause }),
  });
  return rows.map(directiveRecordOf);
});

function scopeRows(
  db: DatabaseClient,
  scope: DirectiveScope,
  facilityId: number,
): Promise<readonly unknown[]> {
  const inFacility = eq(buildings.facilityId, facilityId);
  switch (scope.kind) {
    case "facility":
    case "group":
      return Promise.resolve([scope]);
    case "building":
      return db
        .select({ id: buildings.id })
        .from(buildings)
        .where(and(eq(buildings.id, scope.buildingId), inFacility));
    case "employee":
      return db
        .select({ id: employees.id })
        .from(employees)
        .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
        .where(and(eq(employees.id, scope.employeeId), inFacility));
    default:
      return scope satisfies never;
  }
}

/** Whether a building or employee scope names a row in this facility. No foreign key can say so, because the scope is text. */
const scopeInFacility = Effect.fn("scopeInFacility")(function* (
  scope: DirectiveScope,
  facilityId: number,
) {
  const db = yield* Database;
  const rows = yield* Effect.tryPromise({
    try: () => scopeRows(db, scope, facilityId),
    catch: (cause) => new DirectiveStorageError({ operation: "scope", cause }),
  });
  return rows.length > 0;
});

const findDecision = Effect.fn("findDecision")(function* (decimalId: string) {
  const id = parseDecimalId(decimalId);
  if (Option.isNone(id)) {
    return Option.none();
  }
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () => db.select().from(decisions).where(eq(decisions.id, id.value)),
    catch: (cause) =>
      new DirectiveStorageError({ operation: "decision", cause }),
  });
  return Option.fromNullishOr(row);
});

/** Stored rows, unparsed, so chain verify hashes exactly what was written. */
const chainDirectives = Effect.fn("chainDirectives")(function* (
  recommendationId: number,
) {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db
        .select(getTableColumns(decisionDirectives))
        .from(decisionDirectives)
        .innerJoin(decisions, eq(decisions.id, decisionDirectives.decisionId))
        .where(eq(decisions.recommendationId, recommendationId))
        .orderBy(asc(decisionDirectives.id)),
    catch: (cause) => new DirectiveStorageError({ operation: "chain", cause }),
  });
});

export type { DirectiveContent, DirectiveRecord, DirectiveRow };
export {
  chainDirectives,
  DirectiveRecordSchema,
  DirectiveScopeSchema,
  directiveHash,
  directiveRecordOf,
  findDecision,
  insertDirective,
  listDirectives,
  scopeInFacility,
};
