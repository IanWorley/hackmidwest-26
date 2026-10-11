import {
  decisionMakers,
  decisions,
  facilities,
  recommendations,
} from "@hackmidwest/db";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Semaphore } from "effect";
import { Elysia, type ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  Database,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  decisionBody,
  rejectUnknownFields,
  type ValidationErrorBody,
  validationErrorResponse,
} from "./decision-body";
import {
  listFacilityDecisions,
  verifyDecision,
  verifyResponse,
} from "./decision-history";
import {
  conflictResponse,
  type DecisionOutcome,
  decisionBasis,
} from "./decision-plan";
import {
  type DecisionResponse,
  type DecisionRow,
  decisionResponse,
} from "./decision-view";
import {
  decimalIdParams,
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
} from "./facilities";
import { LIVE_RECOMMENDATION } from "./recommendation-mode";
import {
  DecisionWriteError,
  insertDecision,
  recordDecision,
  type Transaction,
} from "./record-decision";

const RECOMMENDATION_DECISIONS_PATH = "/api/recommendations/:id/decisions";
const FACILITY_DECISIONS_PATH = `${FACILITIES_PATH}/:id/decisions`;
const DECISION_VERIFY_PATH = "/api/decisions/:id/verify";
const RECOMMENDATION_NOT_FOUND_MESSAGE = "Recommendation not found";
const DECISION_NOT_FOUND_MESSAGE = "Decision not found";

// libsql opens a connection per transaction and sets no busy timeout, so two missed-decision
// writes started together would fight over SQLite's write lock. The loser fails, and libsql
// leaves its connection unable to commit again. Queueing them means neither ever fails.
const missedDecisionWrites = Semaphore.makeUnsafe(1);

type RecordDecisionResponse =
  | ElysiaCustomStatusResponse<typeof HTTP_CREATED, DecisionResponse>
  | ElysiaCustomStatusResponse<
      typeof HTTP_NOT_FOUND,
      { message: typeof RECOMMENDATION_NOT_FOUND_MESSAGE }
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_CONFLICT,
      typeof conflictResponse.static
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_UNPROCESSABLE_ENTITY,
      ValidationErrorBody
    >;

const recordDecisionRoute = {
  params: decimalIdParams,
  body: decisionBody,
  transform: rejectUnknownFields(decisionBody),
  response: {
    [HTTP_CREATED]: decisionResponse,
    [HTTP_NOT_FOUND]: t.Object({
      message: t.Literal(RECOMMENDATION_NOT_FOUND_MESSAGE),
    }),
    [HTTP_CONFLICT]: conflictResponse,
    [HTTP_UNPROCESSABLE_ENTITY]: validationErrorResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

const facilityDecisionsRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: t.Array(decisionResponse),
    [HTTP_NOT_FOUND]: facilityNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

const verifyDecisionRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: verifyResponse,
    [HTTP_NOT_FOUND]: t.Object({
      message: t.Literal(DECISION_NOT_FOUND_MESSAGE),
    }),
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

function toHttpResponse(outcome: DecisionOutcome): RecordDecisionResponse {
  switch (outcome.kind) {
    case "recorded":
      return status(HTTP_CREATED, outcome.decision);
    case "recommendation_not_found":
      return status(HTTP_NOT_FOUND, {
        message: RECOMMENDATION_NOT_FOUND_MESSAGE,
      });
    case "conflict":
      return status(HTTP_CONFLICT, outcome.conflict);
    case "rejected":
      return status(HTTP_UNPROCESSABLE_ENTITY, outcome.rejection);
    default:
      return outcome satisfies never;
  }
}

/** The no_decision row to write, or undefined when the recommendation is a preview, a decision exists, or decideBy has not passed. */
async function missedDecisionInTransaction(
  tx: Transaction,
  recommendationId: number,
  now: DateTime.Utc,
): Promise<DecisionRow | undefined> {
  const [target] = await tx
    .select({ recommendation: recommendations, backup: decisionMakers })
    .from(recommendations)
    .innerJoin(facilities, eq(facilities.id, recommendations.facilityId))
    .innerJoin(
      decisionMakers,
      eq(decisionMakers.id, facilities.backupDecisionMakerId),
    )
    .where(and(eq(recommendations.id, recommendationId), LIVE_RECOMMENDATION));
  const [existing] = await tx
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.recommendationId, recommendationId))
    .limit(1);
  if (
    target === undefined ||
    existing !== undefined ||
    DateTime.toEpochMillis(now) <= Date.parse(target.recommendation.decideBy)
  ) {
    return undefined;
  }
  const { decision } = await insertDecision(
    tx,
    {
      ...decisionBasis(target.recommendation, target.backup, now),
      action: "no_decision",
      chosenPosture: null,
      recheckAt: null,
      reasonCategory: null,
      reasonText: null,
      supersedesDecisionId: null,
    },
    [],
  );
  return decision;
}

/**
 * When decideBy has passed on a live recommendation and nobody decided, record a no_decision row naming the facility's
 * backup decision maker. Returns none when a decision exists or decideBy has not passed, so a
 * second run writes nothing, even when both run at once.
 */
const recordMissedDecision = Effect.fn("recordMissedDecision")(function* (
  recommendationId: number,
  now: DateTime.Utc,
) {
  const db = yield* Database;
  const missed = yield* Effect.tryPromise({
    try: () =>
      db.transaction((tx) =>
        missedDecisionInTransaction(tx, recommendationId, now),
      ),
    catch: (cause) => new DecisionWriteError({ cause }),
  }).pipe(Semaphore.withPermit(missedDecisionWrites));
  return Option.fromNullishOr(missed);
});

function createDecisionsModule(runRequest: RunRequest) {
  return new Elysia({ name: "decisions" })
    .post(
      RECOMMENDATION_DECISIONS_PATH,
      ({ params, body }) =>
        runRequest(
          recordDecision(params.id, body).pipe(Effect.map(toHttpResponse)),
        ),
      recordDecisionRoute,
    )
    .get(
      FACILITY_DECISIONS_PATH,
      ({ params }) =>
        runRequest(
          listFacilityDecisions(params.id).pipe(
            Effect.map(
              Option.getOrElse(() =>
                status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE }),
              ),
            ),
          ),
        ),
      facilityDecisionsRoute,
    )
    .get(
      DECISION_VERIFY_PATH,
      ({ params }) =>
        runRequest(
          verifyDecision(params.id).pipe(
            Effect.map(
              Option.getOrElse(() =>
                status(HTTP_NOT_FOUND, { message: DECISION_NOT_FOUND_MESSAGE }),
              ),
            ),
          ),
        ),
      verifyDecisionRoute,
    );
}

export { createDecisionsModule, recordMissedDecision };
