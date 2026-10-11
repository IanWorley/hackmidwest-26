import type { employees } from "@hackmidwest/db";

type DirectiveRecipient = Pick<
  typeof employees.$inferSelect,
  "id" | "assignedBuildingId" | "essentialPersonnel"
>;

const DIRECTIVE_KINDS = ["report", "telework", "dismissed", "excused"] as const;
type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

const DIRECTIVE_SCOPES_BY_SPECIFICITY = [
  "facility",
  "group",
  "building",
  "employee",
] as const;
type DirectiveScopeKind = (typeof DIRECTIVE_SCOPES_BY_SPECIFICITY)[number];

/** #41 parses its stored `building:<id>` / `employee:<id>` / `group:essential` text into this at its route. */
type DirectiveScope =
  | { readonly kind: "facility" }
  | { readonly kind: "group"; readonly group: "essential" }
  | { readonly kind: "building"; readonly buildingId: number }
  | { readonly kind: "employee"; readonly employeeId: number };

interface Directive {
  readonly id: number;
  readonly scope: DirectiveScope;
  readonly directive: DirectiveKind;
  /** A `dismissed` directive's own release time, which wins over the posture's. */
  readonly effectiveAt: string | null;
  readonly reasonCategory: string;
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
    DIRECTIVE_SCOPES_BY_SPECIFICITY.indexOf(a.scope.kind) -
      DIRECTIVE_SCOPES_BY_SPECIFICITY.indexOf(b.scope.kind) ||
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

export type { Directive, DirectiveKind, DirectiveScope, DirectiveScopeKind };
export { winningDirective };
