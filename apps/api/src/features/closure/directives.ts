import {
  DIRECTIVE_SCOPE_KINDS,
  type DirectiveKind,
  type DirectiveScope,
  type DirectiveScopeKind,
  type employees,
  type ReasonCategory,
} from "@hackmidwest/db";

type DirectiveRecipient = Pick<
  typeof employees.$inferSelect,
  "id" | "assignedBuildingId" | "essentialPersonnel"
>;

interface Directive {
  readonly id: number;
  readonly scope: DirectiveScope;
  readonly directive: DirectiveKind;
  /** A `dismissed` directive's own release time, which wins over the posture's. */
  readonly effectiveAt: string | null;
  readonly reasonCategory: ReasonCategory;
  readonly reasonText: string;
  readonly issuedById: number;
  readonly issuedAt: string;
}

const SCOPE_OVERRIDES_BASELINE: Readonly<Record<DirectiveScopeKind, boolean>> =
  {
    facility: false,
    group: false,
    building: false,
    employee: true,
  };

function scopeReaches(
  scope: DirectiveScope,
  recipient: DirectiveRecipient,
): boolean {
  switch (scope.kind) {
    case "facility":
      return true;
    case "group":
      return recipient.essentialPersonnel;
    case "building":
      return scope.buildingId === recipient.assignedBuildingId;
    case "employee":
      return scope.employeeId === recipient.id;
    default:
      return scope satisfies never;
  }
}

function compareDirectives(a: Directive, b: Directive): number {
  return (
    DIRECTIVE_SCOPE_KINDS.indexOf(a.scope.kind) -
      DIRECTIVE_SCOPE_KINDS.indexOf(b.scope.kind) ||
    Date.parse(a.issuedAt) - Date.parse(b.issuedAt) ||
    a.id - b.id
  );
}

/**
 * The most specific directive issued by `now` that reaches this recipient.
 * Ties go to the later issuedAt, then the higher id, so the result is deterministic.
 * `baselineFollowsFacility` is false for someone teleworking or not working, whom only an employee-scoped directive reaches.
 */
function winningDirective(
  recipient: DirectiveRecipient,
  baselineFollowsFacility: boolean,
  directives: readonly Directive[],
  now: string,
): Directive | null {
  const nowMs = Date.parse(now);
  let winner: Directive | null = null;
  for (const directive of directives) {
    if (
      Date.parse(directive.issuedAt) <= nowMs &&
      scopeReaches(directive.scope, recipient) &&
      (SCOPE_OVERRIDES_BASELINE[directive.scope.kind] ||
        baselineFollowsFacility) &&
      (winner === null || compareDirectives(directive, winner) > 0)
    ) {
      winner = directive;
    }
  }
  return winner;
}

export type { Directive };
export { winningDirective };
