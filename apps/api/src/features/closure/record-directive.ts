import {
  buildings,
  DIRECTIVES_WITH_EFFECTIVE_AT,
  type DirectiveKind,
  type DirectiveScope,
  decisionDirectives,
  decisions,
  employees,
  formatDirectiveScope,
} from "@hackmidwest/db";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Semaphore } from "effect";
import { t } from "elysia";
import { Database } from "../../runtime";
import {
  type CurrentDecisionRow,
  findCurrentDecision,
} from "./current-decision";
import { invalidBody, type ValidationErrorBody } from "./decision-body";
import type { RecordContent } from "./decision-chain";
import { DIRECTIVE_FIELDS, type DirectiveBody } from "./directive-body";
import {
  type DirectiveRecord,
  type DirectiveRow,
  directiveRecordOf,
} from "./directive-history";
import { parseDecimalId } from "./facilities";
import {
  DecisionWriteError,
  decisionChainWrites,
  eligibleDecider,
  type Transaction,
} from "./record-decision";
import { contentHash } from "./records";
import { toInstant } from "./zoned-time";

type DirectiveContent = RecordContent<DirectiveRow>;

/** #69's conflict shape, naming the decision a directive may target instead. */
const directiveConflictResponse = t.Union([
  t.Object({
    conflict: t.Literal("not_current_decision"),
    // Null when the facility has no current decision, such as after the facility day rolled over.
    currentDecisionId: t.Nullable(t.Integer()),
  }),
  t.Object({
    // The current decision is a defer or a missed deadline, so there is no posture to qualify.
    conflict: t.Literal("no_chosen_posture"),
    currentDecisionId: t.Integer(),
  }),
]);
type DirectiveConflict = typeof directiveConflictResponse.static;

type DirectiveOutcome =
  | { readonly kind: "recorded"; readonly directive: DirectiveRecord }
  | { readonly kind: "decision_not_found" }
  | {
      readonly kind: "conflict";
      readonly conflict: DirectiveConflict;
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

async function insertDirective(
  tx: Transaction,
  content: DirectiveContent,
): Promise<DirectiveRecord> {
  const [row] = await tx
    .insert(decisionDirectives)
    .values({ ...content, contentHash: contentHash(content) })
    .returning();
  if (row === undefined) {
    throw new Error("The directive insert returned no row");
  }
  return directiveRecordOf(row);
}

/** A directive takes effect only on the facility's current decision, and only when that decision chose a posture. */
function directiveConflict(
  decisionId: number,
  current: CurrentDecisionRow | null,
): DirectiveConflict | null {
  if (current === null || current.id !== decisionId) {
    return {
      conflict: "not_current_decision",
      currentDecisionId: current?.id ?? null,
    };
  }
  if (current.chosenPosture === null) {
    return { conflict: "no_chosen_posture", currentDecisionId: current.id };
  }
  return null;
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
  const current = await findCurrentDecision(
    tx,
    decision.facilityId,
    toInstant(DateTime.toEpochMillis(issuedAt)),
  );
  const conflict = directiveConflict(decision.id, current?.decision ?? null);
  if (conflict !== null) {
    return { kind: "conflict", conflict };
  }
  const directive = await insertDirective(tx, {
    decisionId: decision.id,
    decisionHash: decision.contentHash,
    scope: formatDirectiveScope(body.scope),
    directive: body.directive,
    effectiveAt: body.effectiveAt ?? null,
    reasonCategory: body.reason.category,
    reasonText: body.reason.text,
    issuedById: issuer.id,
    issuedByName: issuer.name,
    issuedByRole: issuer.role,
    issuedAt: DateTime.formatIso(issuedAt),
  });
  return { kind: "recorded", directive };
}

const recordDirective = Effect.fn("recordDirective")(function* (
  decimalId: string,
  body: DirectiveBody,
) {
  const decisionId = parseDecimalId(decimalId);
  if (Option.isNone(decisionId)) {
    return DECISION_NOT_FOUND;
  }
  const db = yield* Database;
  // The clock is read inside the permit, so a decision written while this waited is not after `issuedAt`.
  return yield* Effect.gen(function* () {
    const issuedAt = yield* DateTime.now;
    return yield* Effect.tryPromise({
      try: () =>
        db.transaction((tx) =>
          issueInTransaction(tx, decisionId.value, body, issuedAt),
        ),
      catch: (cause) => new DecisionWriteError({ cause }),
    });
  }).pipe(Semaphore.withPermit(decisionChainWrites));
});

export type { DirectiveOutcome };
export { directiveConflictResponse, recordDirective };
