import { DIRECTIVE_GROUPS, DIRECTIVE_KINDS } from "@hackmidwest/db";
import { t } from "elysia";
import { reasonBody, utcInstant } from "./decision-body";

// JSON Pointers into the request body, the form every body 422 names its field in.
const DIRECTIVE_FIELDS = {
  effectiveAt: "/effectiveAt",
  issuedById: "/issuedById",
  scope: "/scope",
} as const;

const directiveScope = t.Union([
  t.Object({ kind: t.Literal("facility") }),
  t.Object({ kind: t.Literal("group"), group: t.UnionEnum(DIRECTIVE_GROUPS) }),
  t.Object({ kind: t.Literal("building"), buildingId: t.Integer() }),
  t.Object({ kind: t.Literal("employee"), employeeId: t.Integer() }),
]);

const directiveBody = t.Object({
  scope: directiveScope,
  directive: t.UnionEnum(DIRECTIVE_KINDS),
  /** An earlier release time. Only a `dismissed` directive takes one. */
  effectiveAt: t.Optional(utcInstant),
  reason: reasonBody,
  issuedById: t.Integer(),
});
type DirectiveBody = typeof directiveBody.static;

export type { DirectiveBody };
export { DIRECTIVE_FIELDS, directiveBody, directiveScope };
