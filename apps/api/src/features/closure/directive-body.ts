import {
  DIRECTIVE_GROUPS,
  DIRECTIVE_KINDS,
  type DirectiveScopeKind,
} from "@hackmidwest/db";
import type { TObject } from "@sinclair/typebox";
import { t } from "elysia";
import {
  firstInvalidField,
  invalidBody,
  reasonBody,
  utcInstant,
  type ValidationErrorBody,
} from "./decision-body";

// JSON Pointers into the request body, the form every body 422 names its field in.
const DIRECTIVE_FIELDS = {
  effectiveAt: "/effectiveAt",
  issuedById: "/issuedById",
  scope: "/scope",
} as const;
const CLOSED = { additionalProperties: false } as const;
const UNKNOWN_SCOPE_KIND_MESSAGE =
  "Expected scope kind facility, group, building, or employee";

const SCOPE_VARIANTS = {
  facility: t.Object({ kind: t.Literal("facility") }, CLOSED),
  group: t.Object(
    { kind: t.Literal("group"), group: t.UnionEnum(DIRECTIVE_GROUPS) },
    CLOSED,
  ),
  building: t.Object(
    { kind: t.Literal("building"), buildingId: t.Integer() },
    CLOSED,
  ),
  employee: t.Object(
    { kind: t.Literal("employee"), employeeId: t.Integer() },
    CLOSED,
  ),
} as const satisfies Record<DirectiveScopeKind, TObject>;

const scopeVariantsByKind = new Map<unknown, TObject>(
  Object.entries(SCOPE_VARIANTS),
);

const directiveScope = t.Union([
  SCOPE_VARIANTS.facility,
  SCOPE_VARIANTS.group,
  SCOPE_VARIANTS.building,
  SCOPE_VARIANTS.employee,
]);

const directiveBody = t.Object(
  {
    scope: directiveScope,
    directive: t.UnionEnum(DIRECTIVE_KINDS),
    /** An earlier release time. Only a `dismissed` directive takes one. */
    effectiveAt: t.Optional(utcInstant),
    reason: reasonBody,
    issuedById: t.Integer(),
  },
  CLOSED,
);
type DirectiveBody = typeof directiveBody.static;

function member(found: unknown, key: string): unknown {
  if (typeof found === "object" && found !== null && key in found) {
    return Reflect.get(found, key);
  }
  return undefined;
}

/** A scope union failure only says "Expected union value", so report the first error of the variant `kind` selects. */
function describeInvalidDirective(found: unknown): ValidationErrorBody {
  const invalid = firstInvalidField(directiveBody, found);
  if (invalid.property !== DIRECTIVE_FIELDS.scope) {
    return invalid;
  }
  const scope = member(found, "scope");
  const variant = scopeVariantsByKind.get(member(scope, "kind"));
  if (variant === undefined) {
    return invalidBody(DIRECTIVE_FIELDS.scope, UNKNOWN_SCOPE_KIND_MESSAGE);
  }
  const inScope = firstInvalidField(variant, scope);
  return invalidBody(
    `${DIRECTIVE_FIELDS.scope}${inScope.property}`,
    inScope.message,
  );
}

export type { DirectiveBody };
export {
  DIRECTIVE_FIELDS,
  describeInvalidDirective,
  directiveBody,
  directiveScope,
};
