import { Clock, Effect, Option } from "effect";
import { Elysia, ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { decimalIdParams, parseDecimalId } from "../decimal-id";
import { ChainVerificationSchema, verifyChain } from "./decision-chain";
import {
  actionColumns,
  type DecisionRequest,
  decisionChanged,
  decisionConflictResponse,
  decisionRequestSchema,
  HTTP_CONFLICT,
  HTTP_UNPROCESSABLE,
  invalidBodyField,
  invalidDecision,
  invalidDecisionResponse,
  newerRecommendation,
  supersedesWithoutReason,
} from "./decision-request";
import {
  DecisionRecordSchema,
  facilityHistory,
  findChainTip,
  findDecider,
  insertDecision,
  loadChain,
} from "./decision-store";
import {
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
  getFacility,
} from "./facilities";
import {
  findRecommendation,
  latestRecommendationOf,
} from "./recommendation-store";
import {
  RECOMMENDATIONS_PATH,
  recommendationNotFound,
  recommendationNotFoundResponse,
} from "./recommendations";

const DECIDE_PATH = `${RECOMMENDATIONS_PATH}/:id/decisions`;
const FACILITY_DECISIONS_PATH = `${FACILITIES_PATH}/:id/decisions`;
const DECISIONS_PATH = "/api/decisions";
const VERIFY_PATH = `${DECISIONS_PATH}/:id/verify`;
const DECISION_NOT_FOUND_MESSAGE = "Decision not found";
const ID_FIELD = "id";

const decisionNotFoundResponse = t.Object({
  message: t.Literal(DECISION_NOT_FOUND_MESSAGE),
});

function decisionNotFound(): ElysiaCustomStatusResponse<
  typeof HTTP_NOT_FOUND,
  typeof decisionNotFoundResponse.static
> {
  return status(HTTP_NOT_FOUND, { message: DECISION_NOT_FOUND_MESSAGE });
}

const decideRequest = Effect.fn("decideRequest")(function* (
  decimalId: string,
  request: DecisionRequest,
) {
  const found = yield* findRecommendation(decimalId);
  if (Option.isNone(found)) {
    return recommendationNotFound();
  }
  const recommendation = found.value;
  const latest = yield* latestRecommendationOf(recommendation.facilityId);
  if (Option.isSome(latest) && latest.value.id !== recommendation.id) {
    return newerRecommendation(latest.value.id);
  }
  const tip = Option.getOrNull(yield* findChainTip(recommendation.id));
  if (tip !== (request.supersedesDecisionId ?? null)) {
    return decisionChanged(tip);
  }
  if (supersedesWithoutReason(request)) {
    return invalidDecision("reason");
  }
  const decider = yield* findDecider(request.decidedById);
  if (Option.isNone(decider)) {
    return invalidDecision("decidedById");
  }
  const decidedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  const columns = actionColumns(request, recommendation, decidedAt);
  if (columns instanceof ElysiaCustomStatusResponse) {
    return columns;
  }
  const record = yield* insertDecision(
    {
      recommendationId: recommendation.id,
      recommendationHash: recommendation.contentHash,
      facilityId: recommendation.facilityId,
      action: request.action,
      ...columns,
      decidedById: decider.value.id,
      decidedByName: decider.value.name,
      decidedByRole: decider.value.role,
      decidedAt,
      identityVerified: false,
      reasonCategory: request.reason?.category ?? null,
      reasonText: request.reason?.text ?? null,
      supersedesDecisionId: tip,
      humanInputs: (request.humanInputs ?? []).map((input) => ({
        reportedBy: input.reportedBy,
        reportedAt: new Date(input.reportedAt ?? decidedAt).toISOString(),
        text: input.text,
      })),
    },
    recommendation.decideBy,
  );
  return status(HTTP_CREATED, record);
});

const historyRequest = Effect.fn("historyRequest")(function* (
  decimalFacilityId: string,
) {
  const facility = yield* getFacility(decimalFacilityId);
  if (Option.isNone(facility)) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  return yield* facilityHistory(facility.value.id);
});

const verifyRequest = Effect.fn("verifyRequest")(function* (decimalId: string) {
  const id = parseDecimalId(decimalId);
  if (Option.isNone(id)) {
    return decisionNotFound();
  }
  const chain = yield* loadChain(id.value);
  if (Option.isNone(chain)) {
    return decisionNotFound();
  }
  return verifyChain(id.value, chain.value);
});

export function createDecisionsModule(runRequest: RunRequest) {
  return new Elysia({ name: "decisions" })
    .post(
      DECIDE_PATH,
      ({ params, body }) => runRequest(decideRequest(params.id, body)),
      {
        params: decimalIdParams,
        body: decisionRequestSchema,
        error: ({ code, error }) => {
          if (code !== "VALIDATION") {
            return;
          }
          if (error.type === "body") {
            return invalidDecision(invalidBodyField(error.value));
          }
          return invalidDecision(ID_FIELD);
        },
        response: {
          [HTTP_CREATED]: DecisionRecordSchema,
          [HTTP_NOT_FOUND]: recommendationNotFoundResponse,
          [HTTP_CONFLICT]: decisionConflictResponse,
          [HTTP_UNPROCESSABLE]: invalidDecisionResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .get(
      FACILITY_DECISIONS_PATH,
      ({ params }) => runRequest(historyRequest(params.id)),
      {
        params: decimalIdParams,
        response: {
          [HTTP_OK]: t.Array(DecisionRecordSchema),
          [HTTP_NOT_FOUND]: facilityNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .get(VERIFY_PATH, ({ params }) => runRequest(verifyRequest(params.id)), {
      params: decimalIdParams,
      response: {
        [HTTP_OK]: ChainVerificationSchema,
        [HTTP_NOT_FOUND]: decisionNotFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    });
}

export { DECISIONS_PATH };
