import {
  type DecisionAction,
  REASON_CATEGORIES,
  recommendations,
} from "@hackmidwest/db";
import { FormatRegistry, type TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createSchemaFactory } from "drizzle-typebox";
import { t } from "elysia";

const UTC_INSTANT_FORMAT = "utc-instant";
const NON_BLANK_PATTERN = "\\S";
// JSON Pointers into the request body, the form Elysia's own validation errors use.
const BODY_FIELDS = {
  action: "/action",
  chosenPosture: "/chosenPosture",
  decidedById: "/decidedById",
  reason: "/reason",
  recheckAt: "/recheckAt",
} as const;
const BODY_ROOT = "";
const INVALID_BODY_MESSAGE = "Invalid decision";
const UNKNOWN_ACTION_MESSAGE = "Expected action accept, override, or defer";

// Exactly `Date.prototype.toISOString()`, the only instant form the database CHECKs accept.
// The round trip also rejects impossible dates such as Feb 30.
FormatRegistry.Set(UTC_INSTANT_FORMAT, (value) => {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
});

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

/** A person's action. `no_decision` is recorded only when decideBy passes. */
type RequestedAction = Exclude<DecisionAction, "no_decision">;

const utcInstant = t.String({ format: UTC_INSTANT_FORMAT });
const nonBlankText = t.String({ pattern: NON_BLANK_PATTERN });
const reasonBody = t.Object({
  category: t.UnionEnum(REASON_CATEGORIES),
  text: nonBlankText,
});
const sharedDecisionFields = {
  decidedById: t.Integer(),
  supersedesDecisionId: t.Optional(t.Integer()),
  humanInputs: t.Optional(
    t.Array(
      t.Object({
        reportedBy: nonBlankText,
        reportedAt: utcInstant,
        text: nonBlankText,
      }),
    ),
  ),
};

const DECISION_BODY_VARIANTS = {
  accept: t.Object({
    action: t.Literal("accept"),
    ...sharedDecisionFields,
    reason: t.Optional(reasonBody),
  }),
  override: t.Object({
    action: t.Literal("override"),
    chosenPosture: createSelectSchema(recommendations).properties.posture,
    ...sharedDecisionFields,
    reason: reasonBody,
  }),
  defer: t.Object({
    action: t.Literal("defer"),
    recheckAt: utcInstant,
    ...sharedDecisionFields,
    reason: reasonBody,
  }),
} as const satisfies Record<RequestedAction, TObject>;

const variantsByAction = new Map<unknown, TObject>(
  Object.entries(DECISION_BODY_VARIANTS),
);

const validationErrorResponse = t.Object({
  type: t.Literal("validation"),
  on: t.String(),
  property: t.String(),
  message: t.String(),
});
type ValidationErrorBody = typeof validationErrorResponse.static;

function invalidBody(property: string, message: string): ValidationErrorBody {
  return { type: "validation", on: "body", property, message };
}

function requestedAction(found: unknown): unknown {
  if (typeof found === "object" && found !== null && "action" in found) {
    return found.action;
  }
  return undefined;
}

/** A union failure only says "Expected union value", so report the first error of the variant `action` selects. */
function describeInvalidBody({
  found,
}: {
  readonly found: unknown;
}): ValidationErrorBody {
  const variant = variantsByAction.get(requestedAction(found));
  if (variant === undefined) {
    return invalidBody(BODY_FIELDS.action, UNKNOWN_ACTION_MESSAGE);
  }
  const error = Value.Errors(variant, found).First();
  if (error === undefined) {
    return invalidBody(BODY_ROOT, INVALID_BODY_MESSAGE);
  }
  return invalidBody(error.path, error.message);
}

const decisionBody = t.Union(
  [
    DECISION_BODY_VARIANTS.accept,
    DECISION_BODY_VARIANTS.override,
    DECISION_BODY_VARIANTS.defer,
  ],
  { error: describeInvalidBody },
);
type DecisionBody = typeof decisionBody.static;

export type { DecisionBody, ValidationErrorBody };
export { BODY_FIELDS, decisionBody, invalidBody, validationErrorResponse };
