import {
  type DirectiveScope,
  decisionDirectives,
  decisions,
  parseDirectiveScope,
} from "@hackmidwest/db";
import { asc, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import { directiveScope } from "./directive-body";
import { parseDecimalId } from "./facilities";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

type DirectiveRow = typeof decisionDirectives.$inferSelect;

/** A stored directive with its scope parsed. It satisfies the resolver's `Directive`. */
type DirectiveRecord = Omit<DirectiveRow, "scope"> & {
  readonly scope: DirectiveScope;
};

const directiveResponse = t.Object({
  ...createSelectSchema(decisionDirectives).properties,
  scope: directiveScope,
});

class DirectiveReadError extends Data.TaggedError("DirectiveReadError")<{
  readonly cause: unknown;
}> {}

/** The one place stored scope text becomes a typed scope. The scope CHECK admits only text this parses, so a miss is a defect. */
function directiveRecordOf(row: DirectiveRow): DirectiveRecord {
  const scope = parseDirectiveScope(row.scope);
  if (scope === null) {
    throw new TypeError(
      `decision_directives row ${row.id} has an unreadable scope: ${row.scope}`,
    );
  }
  return { ...row, scope };
}

/** Every directive on the decision, oldest first. */
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
    catch: (cause) => new DirectiveReadError({ cause }),
  });
  return rows.map(directiveRecordOf);
});

/** The decision's directives, or none when no decision has the id. */
const listDecisionDirectives = Effect.fn("listDecisionDirectives")(function* (
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
        .select({ id: decisions.id })
        .from(decisions)
        .where(eq(decisions.id, decisionId.value)),
    catch: (cause) => new DirectiveReadError({ cause }),
  });
  if (decision === undefined) {
    return Option.none();
  }
  return Option.some(yield* listDirectives(decision.id));
});

export type { DirectiveRecord, DirectiveRow };
export {
  directiveRecordOf,
  directiveResponse,
  listDecisionDirectives,
  listDirectives,
};
