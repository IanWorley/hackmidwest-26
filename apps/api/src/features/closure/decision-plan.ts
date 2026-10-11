import type { decisionMakers, recommendations } from "@hackmidwest/db";
import { DateTime } from "effect";
import { t } from "elysia";
import {
  BODY_FIELDS,
  type DecisionBody,
  invalidBody,
  type ValidationErrorBody,
} from "./decision-body";
import type { RecordContent } from "./decision-chain";
import type { DecisionResponse, DecisionRow } from "./decision-view";
import { modeOf } from "./recommendation-mode";

type RecommendationRow = typeof recommendations.$inferSelect;
type DecisionMakerRow = typeof decisionMakers.$inferSelect;
type DecisionContent = RecordContent<DecisionRow>;

const conflictResponse = t.Union([
  t.Object({
    // An as-of preview is never decided. This names the live recommendation to decide instead, or null when there is none.
    conflict: t.Literal("preview_recommendation"),
    latestRecommendationId: t.Nullable(t.Integer()),
  }),
  t.Object({
    conflict: t.Literal("newer_recommendation"),
    latestRecommendationId: t.Integer(),
  }),
  t.Object({
    conflict: t.Literal("newer_decision"),
    // Null when the recommendation has no decision yet, so there is nothing to supersede.
    latestDecisionId: t.Nullable(t.Integer()),
  }),
]);
type ConflictBody = typeof conflictResponse.static;

type Refusal =
  | { readonly kind: "recommendation_not_found" }
  | { readonly kind: "conflict"; readonly conflict: ConflictBody }
  | { readonly kind: "rejected"; readonly rejection: ValidationErrorBody };
type DecisionOutcome =
  | { readonly kind: "recorded"; readonly decision: DecisionResponse }
  | Refusal;

/** Everything the write path reads before it decides whether to insert. */
interface DecisionContext {
  readonly recommendation: RecommendationRow;
  readonly decider: DecisionMakerRow | undefined;
  /** The facility's newest live recommendation, null when it has only previews. */
  readonly latestRecommendationId: number | null;
  readonly latestDecisionId: number | null;
}

const DECIDER_NOT_ELIGIBLE_MESSAGE =
  "Only the facility's decision maker or its backup can decide";

const RECOMMENDATION_NOT_FOUND: Refusal = { kind: "recommendation_not_found" };

function rejected(property: string, message: string): Refusal {
  return { kind: "rejected", rejection: invalidBody(property, message) };
}

/** The columns every decision copies from what the decider saw and who they are. */
function decisionBasis(
  recommendation: RecommendationRow,
  decider: DecisionMakerRow,
  decidedAt: DateTime.Utc,
): Pick<
  DecisionContent,
  | "recommendationId"
  | "recommendationHash"
  | "facilityId"
  | "decidedById"
  | "decidedByName"
  | "decidedByRole"
  | "decidedAt"
  | "identityVerified"
> {
  return {
    recommendationId: recommendation.id,
    recommendationHash: recommendation.contentHash,
    facilityId: recommendation.facilityId,
    decidedById: decider.id,
    decidedByName: decider.name,
    decidedByRole: decider.role,
    decidedAt: DateTime.formatIso(decidedAt),
    identityVerified: false,
  };
}

/** The columns each action determines, or why the action does not fit the recommendation. */
function actionColumns(
  body: DecisionBody,
  recommendation: RecommendationRow,
  decidedAt: DateTime.Utc,
): Refusal | Pick<DecisionContent, "action" | "chosenPosture" | "recheckAt"> {
  switch (body.action) {
    case "accept":
      return {
        action: "accept",
        chosenPosture: recommendation.posture,
        recheckAt: null,
      };
    case "override":
      if (body.chosenPosture === recommendation.posture) {
        return rejected(
          BODY_FIELDS.chosenPosture,
          "An override must choose a posture other than the recommended one",
        );
      }
      return {
        action: "override",
        chosenPosture: body.chosenPosture,
        recheckAt: null,
      };
    case "defer":
      if (
        Date.parse(body.recheckAt) <= DateTime.toEpochMillis(decidedAt) ||
        Date.parse(body.recheckAt) >= Date.parse(recommendation.decideBy)
      ) {
        return rejected(
          BODY_FIELDS.recheckAt,
          "A deferral must recheck after the decision and before the recommendation's decideBy",
        );
      }
      return {
        action: "defer",
        chosenPosture: null,
        recheckAt: body.recheckAt,
      };
    default:
      return body satisfies never;
  }
}

/** A stale view loses: the request must name the newest live recommendation and the newest decision on it. */
function conflictFor(
  body: DecisionBody,
  context: DecisionContext,
): Refusal | undefined {
  if (modeOf(context.recommendation) === "as_of") {
    return {
      kind: "conflict",
      conflict: {
        conflict: "preview_recommendation",
        latestRecommendationId: context.latestRecommendationId,
      },
    };
  }
  if (
    context.latestRecommendationId !== null &&
    context.latestRecommendationId !== context.recommendation.id
  ) {
    return {
      kind: "conflict",
      conflict: {
        conflict: "newer_recommendation",
        latestRecommendationId: context.latestRecommendationId,
      },
    };
  }
  if ((body.supersedesDecisionId ?? null) !== context.latestDecisionId) {
    return {
      kind: "conflict",
      conflict: {
        conflict: "newer_decision",
        latestDecisionId: context.latestDecisionId,
      },
    };
  }
  return undefined;
}

function planDecision(
  body: DecisionBody,
  context: DecisionContext,
  decidedAt: DateTime.Utc,
): Refusal | DecisionContent {
  const conflict = conflictFor(body, context);
  if (conflict !== undefined) {
    return conflict;
  }
  if (context.decider === undefined) {
    return rejected(BODY_FIELDS.decidedById, DECIDER_NOT_ELIGIBLE_MESSAGE);
  }
  if (body.supersedesDecisionId !== undefined && body.reason === undefined) {
    return rejected(
      BODY_FIELDS.reason,
      "Changing a decision requires a reason",
    );
  }
  const lateInput = (body.humanInputs ?? []).findIndex(
    (input) => Date.parse(input.reportedAt) > DateTime.toEpochMillis(decidedAt),
  );
  if (lateInput !== -1) {
    return rejected(
      `${BODY_FIELDS.humanInputs}/${lateInput}/reportedAt`,
      "A human input cannot be reported after the decision",
    );
  }
  const columns = actionColumns(body, context.recommendation, decidedAt);
  if ("kind" in columns) {
    return columns;
  }
  return {
    ...decisionBasis(context.recommendation, context.decider, decidedAt),
    ...columns,
    reasonCategory: body.reason?.category ?? null,
    reasonText: body.reason?.text ?? null,
    supersedesDecisionId: body.supersedesDecisionId ?? null,
  };
}

export type { DecisionContent, DecisionContext, DecisionOutcome };
export {
  conflictResponse,
  DECIDER_NOT_ELIGIBLE_MESSAGE,
  decisionBasis,
  planDecision,
  RECOMMENDATION_NOT_FOUND,
};
