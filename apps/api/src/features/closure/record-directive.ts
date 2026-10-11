import {
  buildings,
  DIRECTIVES_WITH_EFFECTIVE_AT,
  type DirectiveKind,
  type DirectiveScope,
  decisionDirectives,
  decisions,
  employees,
  formatDirectiveScope,
  SUPERSEDED_DECISION_MESSAGE,
} from "@hackmidwest/db";
import { and, desc, eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../runtime";
import { invalidBody, type ValidationErrorBody } from "./decision-body";
import type { RecordContent } from "./decision-chain";
import type { newerDecisionConflict } from "./decision-plan";
import { DIRECTIVE_FIELDS, type DirectiveBody } from "./directive-body";
import {
  type DirectiveRecord,
  type DirectiveRow,
  directiveRecordOf,
} from "./directive-history";
import { parseDecimalId } from "./facilities";
import {
  DecisionWriteError,
  eligibleDecider,
  type Transaction,
} from "./record-decision";
import { contentHash } from "./records";

type DirectiveContent = RecordContent<DirectiveRow>;
type DecisionRow = typeof decisions.$inferSelect;

type DirectiveOutcome =
  | { readonly kind: "recorded"; readonly directive: DirectiveRecord }
  | { readonly kind: "decision_not_found" }
  | {
      readonly kind: "conflict";
      readonly conflict: typeof newerDecisionConflict.static;
    }
  | { readonly kind: "rejected"; readonly rejection: ValidationErrorBody };

const ISSUER_NOT_ELIGIBLE_MESSAGE =
  "Only the facility's decision maker or its backup can issue a directive";
const EFFECTIVE_AT_NOT_DISMISSAL_MESSAGE =
  "Only a dismissed directive takes an effectiveAt release time";
const SCOPE_OUTSIDE_FACILITY_MESSAGE =
  "The scope must name a building or employee of the decision's facility";

const DECISION_NOT_FOUND: DirectiveOutcome = { kind: "decision_not_found" };

function rejected(property: string, message: string): DirectiveOutcome {
  return { kind: "rejected", rejection: invalidBody(property, message) };
}

function takesEffectiveAt(directive: DirectiveKind): boolean {
  const kinds: readonly DirectiveKind[] = DIRECTIVES_WITH_EFFECTIVE_AT;
  return kinds.includes(directive);
}

/** Whether a building or employee scope names a row in this facility. No foreign key can say so, because the scope is text. */
async function scopeInFacility(
  tx: Transaction,
  scope: DirectiveScope,
  facilityId: number,
): Promise<boolean> {
  const inFacility = eq(buildings.facilityId, facilityId);
  switch (scope.kind) {
    case "facility":
    case "group":
      return true;
    case "building": {
      const [building] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(and(eq(buildings.id, scope.buildingId), inFacility));
      return building !== undefined;
    }
    case "employee": {
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
        .where(and(eq(employees.id, scope.employeeId), inFacility));
      return employee !== undefined;
    }
    default:
      return scope satisfies never;
  }
}

function raised(error: unknown, message: string): boolean {
  return (
    error instanceof Error &&
    (error.message.includes(message) || raised(error.cause, message))
  );
}

async function newestDecisionId(
  tx: Transaction,
  recommendationId: number,
): Promise<number | null> {
  const [newest] = await tx
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.recommendationId, recommendationId))
    .orderBy(desc(decisions.id))
    .limit(1);
  return newest?.id ?? null;
}

/** The superseded-decision check lives in migration 0006's trigger alone, so its abort is the 409. */
async function insertDirective(
  tx: Transaction,
  decision: DecisionRow,
  content: DirectiveContent,
): Promise<DirectiveOutcome> {
  try {
    const [row] = await tx
      .insert(decisionDirectives)
      .values({ ...content, contentHash: contentHash(content) })
      .returning();
    if (row === undefined) {
      throw new Error("The directive insert returned no row");
    }
    return { kind: "recorded", directive: directiveRecordOf(row) };
  } catch (cause) {
    if (!raised(cause, SUPERSEDED_DECISION_MESSAGE)) {
      throw cause;
    }
    return {
      kind: "conflict",
      conflict: {
        conflict: "newer_decision",
        latestDecisionId: await newestDecisionId(tx, decision.recommendationId),
      },
    };
  }
}

async function issueInTransaction(
  tx: Transaction,
  decisionId: number,
  body: DirectiveBody,
  issuedAt: DateTime.Utc,
): Promise<DirectiveOutcome> {
  const [decision] = await tx
    .select()
    .from(decisions)
    .where(eq(decisions.id, decisionId));
  if (decision === undefined) {
    return DECISION_NOT_FOUND;
  }
  const issuer = await eligibleDecider(
    tx,
    decision.facilityId,
    body.issuedById,
  );
  if (issuer === undefined) {
    return rejected(DIRECTIVE_FIELDS.issuedById, ISSUER_NOT_ELIGIBLE_MESSAGE);
  }
  if (body.effectiveAt !== undefined && !takesEffectiveAt(body.directive)) {
    return rejected(
      DIRECTIVE_FIELDS.effectiveAt,
      EFFECTIVE_AT_NOT_DISMISSAL_MESSAGE,
    );
  }
  if (!(await scopeInFacility(tx, body.scope, decision.facilityId))) {
    return rejected(DIRECTIVE_FIELDS.scope, SCOPE_OUTSIDE_FACILITY_MESSAGE);
  }
  return insertDirective(tx, decision, {
    decisionId: decision.id,
    decisionHash: decision.contentHash,
    scope: formatDirectiveScope(body.scope),
    directive: body.directive,
    effectiveAt: body.effectiveAt ?? null,
    reasonCategory: body.reason.category,
    reasonText: body.reason.text,
    issuedById: issuer.id,
    issuedAt: DateTime.formatIso(issuedAt),
  });
}

const recordDirective = Effect.fn("recordDirective")(function* (
  decimalId: string,
  body: DirectiveBody,
) {
  const decisionId = parseDecimalId(decimalId);
  if (Option.isNone(decisionId)) {
    return DECISION_NOT_FOUND;
  }
  const issuedAt = yield* DateTime.now;
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db.transaction((tx) =>
        issueInTransaction(tx, decisionId.value, body, issuedAt),
      ),
    catch: (cause) => new DecisionWriteError({ cause }),
  });
});

export type { DirectiveOutcome };
export { recordDirective };
