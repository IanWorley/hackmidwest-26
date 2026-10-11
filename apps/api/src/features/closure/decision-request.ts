import { type DecisionAction, REASON_CATEGORIES } from "@hackmidwest/db";
import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { DecisionContent } from "./decision-store";
import { postureSchema } from "./postures";
import type { RecommendationRow } from "./recommendation-store";
import { parseInstant } from "./zoned-time";

const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const INVALID_DECISION_MESSAGE = "Invalid decision";
const NEWER_RECOMMENDATION_MESSAGE =
  "A newer recommendation exists for this facility";
const DECISION_CHANGED_MESSAGE =
  "The decision on this recommendation changed since it was loaded";
const NON_BLANK_PATTERN = "\\S";

type HumanAction = Exclude<DecisionAction, "no_decision">;

const nonBlankText = t.String({ pattern: NON_BLANK_PATTERN });
/** An unknown field is a 422, so a client that meant to override is not silently accepted. */
const closedObject = { additionalProperties: false } as const;
const instant = t.String({ format: "date-time" });

const reasonSchema = t.Object({
  category: t.UnionEnum(REASON_CATEGORIES),
  text: nonBlankText,
});

const sharedFields = {
  /** A `decision_makers` row; the app records who acted without verifying identity. */
  decidedById: t.Integer({ minimum: 1 }),
  /** The newest decision on this recommendation, required when there is one, so a change never lands on a decision the person did not see. */
  supersedesDecisionId: t.Optional(t.Integer({ minimum: 1 })),
  humanInputs: t.Optional(
    t.Array(
      t.Object({
        reportedBy: nonBlankText,
        /** Defaults to the decision time. */
        reportedAt: t.Optional(instant),
        text: nonBlankText,
      }),
    ),
  ),
};

const DECISION_REQUESTS = {
  accept: t.Object(
    {
      action: t.Literal("accept"),
      reason: t.Optional(reasonSchema),
      ...sharedFields,
    },
    closedObject,
  ),
  override: t.Object(
    {
      action: t.Literal("override"),
      posture: postureSchema,
      reason: reasonSchema,
      ...sharedFields,
    },
    closedObject,
  ),
  defer: t.Object(
    {
      action: t.Literal("defer"),
      recheckAt: instant,
      reason: reasonSchema,
      ...sharedFields,
    },
    closedObject,
  ),
} as const satisfies Record<HumanAction, TObject>;

const decisionRequestSchema = t.Union([
  DECISION_REQUESTS.accept,
  DECISION_REQUESTS.override,
  DECISION_REQUESTS.defer,
]);

type DecisionRequest = typeof decisionRequestSchema.static;

const invalidDecisionResponse = t.Object({
  message: t.Literal(INVALID_DECISION_MESSAGE),
  /** Dotted path to the offending field, such as `reason` or `humanInputs.0.text`. */
  field: t.String(),
});

const decisionConflictResponse = t.Union([
  t.Object({
    conflict: t.Literal("newer_recommendation"),
    message: t.Literal(NEWER_RECOMMENDATION_MESSAGE),
    latestRecommendationId: t.Integer(),
  }),
  t.Object({
    conflict: t.Literal("decision_changed"),
    message: t.Literal(DECISION_CHANGED_MESSAGE),
    latestDecisionId: t.Union([t.Integer(), t.Null()]),
  }),
]);

type DecisionConflict = ElysiaCustomStatusResponse<
  typeof HTTP_CONFLICT,
  typeof decisionConflictResponse.static
>;

function newerRecommendation(latestRecommendationId: number): DecisionConflict {
  return status(HTTP_CONFLICT, {
    conflict: "newer_recommendation",
    message: NEWER_RECOMMENDATION_MESSAGE,
    latestRecommendationId,
  });
}

function decisionChanged(latestDecisionId: number | null): DecisionConflict {
  return status(HTTP_CONFLICT, {
    conflict: "decision_changed",
    message: DECISION_CHANGED_MESSAGE,
    latestDecisionId,
  });
}

type InvalidDecision = ElysiaCustomStatusResponse<
  typeof HTTP_UNPROCESSABLE,
  typeof invalidDecisionResponse.static
>;

function invalidDecision(field: string): InvalidDecision {
  return status(HTTP_UNPROCESSABLE, {
    message: INVALID_DECISION_MESSAGE,
    field,
  });
}

function isDecisionAction(value: unknown): value is HumanAction {
  return typeof value === "string" && Object.hasOwn(DECISION_REQUESTS, value);
}

/** A failed union names no field, so check the body against the variant its `action` picks. */
function invalidBodyField(body: unknown): string {
  if (typeof body !== "object" || body === null || !("action" in body)) {
    return "action";
  }
  const { action } = body;
  if (!isDecisionAction(action)) {
    return "action";
  }
  const first = Value.Errors(DECISION_REQUESTS[action], body).First();
  if (first === undefined) {
    return "action";
  }
  return first.path.slice(1).replaceAll("/", ".");
}

function supersedesWithoutReason(request: DecisionRequest): boolean {
  return (
    request.supersedesDecisionId !== undefined && request.reason === undefined
  );
}

type ActionColumns = Pick<DecisionContent, "chosenPosture" | "recheckAt">;

function actionColumns(
  request: DecisionRequest,
  recommendation: RecommendationRow,
  decidedAt: string,
): ActionColumns | InvalidDecision {
  switch (request.action) {
    case "accept":
      return { chosenPosture: recommendation.posture, recheckAt: null };
    case "override":
      if (request.posture === recommendation.posture) {
        return invalidDecision("posture");
      }
      return { chosenPosture: request.posture, recheckAt: null };
    case "defer": {
      const recheckAt = parseInstant(request.recheckAt);
      if (
        recheckAt <= parseInstant(decidedAt) ||
        recheckAt >= parseInstant(recommendation.decideBy)
      ) {
        return invalidDecision("recheckAt");
      }
      return {
        chosenPosture: null,
        recheckAt: new Date(recheckAt).toISOString(),
      };
    }
    default:
      return request satisfies never;
  }
}

export type { DecisionRequest };
export {
  actionColumns,
  DECISION_REQUESTS,
  decisionChanged,
  decisionConflictResponse,
  decisionRequestSchema,
  HTTP_CONFLICT,
  HTTP_UNPROCESSABLE,
  instant,
  invalidBodyField,
  invalidDecision,
  invalidDecisionResponse,
  newerRecommendation,
  reasonSchema,
  supersedesWithoutReason,
};
