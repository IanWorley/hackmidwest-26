import { DateTime, Effect, Option } from "effect";
import { Elysia, type ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { recordMissedDecision } from "./decisions";
import { evaluatePosture } from "./engine";
import type { EngineInput } from "./engine-input";
import {
  decimalIdParams,
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  type Facility,
  facilityNotFoundResponse,
  getFacility,
  parseDecimalId,
} from "./facilities";
import { pullInput } from "./recommendation-input";
import { RecommendationSchema } from "./recommendation-snapshot";
import {
  findLatestRecommendation,
  findRecommendation,
  insertRecommendation,
  parseSnapshot,
  RecommendationRecordSchema,
  type RecommendationRow,
  type Snapshot,
  toRecord,
} from "./recommendation-store";
import { canonicalJson } from "./records";

const FACILITY_RECOMMENDATIONS_PATH = `${FACILITIES_PATH}/:id/recommendations`;
const LATEST_RECOMMENDATION_PATH = `${FACILITY_RECOMMENDATIONS_PATH}/latest`;
const RECOMMENDATIONS_PATH = "/api/recommendations";
const RECOMMENDATION_PATH = `${RECOMMENDATIONS_PATH}/:id`;
const REPLAY_PATH = `${RECOMMENDATION_PATH}/replay`;
const RECOMMENDATION_NOT_FOUND_MESSAGE = "Recommendation not found";

const evaluateBody = t.Optional(
  t.Object({
    /** Evaluate the data pulled now as of this instant instead of the clock reading. A future instant previews a later call, such as tomorrow morning's. */
    asOf: t.Optional(t.String({ format: "date-time" })),
  }),
);

const recommendationNotFoundResponse = t.Object({
  message: t.Literal(RECOMMENDATION_NOT_FOUND_MESSAGE),
});

const evaluateRoute = {
  params: decimalIdParams,
  body: evaluateBody,
  response: {
    [HTTP_CREATED]: RecommendationRecordSchema,
    [HTTP_NOT_FOUND]: facilityNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

const recordRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: RecommendationRecordSchema,
    [HTTP_NOT_FOUND]: recommendationNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

const replayResponse = t.Object({
  id: t.Integer(),
  stored: RecommendationSchema,
  replayed: RecommendationSchema,
  matches: t.Boolean(),
});

const replayRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: replayResponse,
    [HTTP_NOT_FOUND]: recommendationNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

function recommendationNotFound(): ElysiaCustomStatusResponse<
  typeof HTTP_NOT_FOUND,
  typeof recommendationNotFoundResponse.static
> {
  return status(HTTP_NOT_FOUND, { message: RECOMMENDATION_NOT_FOUND_MESSAGE });
}

/** Runs the engine and parses its output through the stored schema, so what is hashed is exactly what a reader gets back. */
function evaluateSnapshot(input: EngineInput): Snapshot {
  return parseSnapshot({ input, output: evaluatePosture(input) });
}

/**
 * Reads the clock once. An `asOf` changes only the engine's `now`; the data is pulled live and the
 * missed-deadline check uses the clock, because nobody deciding is a fact about real time.
 */
const evaluateFacility = Effect.fn("evaluateFacility")(function* (
  facility: Facility,
  requestedAsOf: string | undefined,
) {
  const now = yield* DateTime.now;
  const evaluatedAt = DateTime.formatIso(now);
  let asOf = evaluatedAt;
  if (requestedAsOf !== undefined) {
    asOf = new Date(requestedAsOf).toISOString();
  }
  const snapshot = evaluateSnapshot(
    yield* pullInput(facility, asOf, evaluatedAt),
  );
  const previous = yield* findLatestRecommendation(facility.id);
  if (Option.isSome(previous)) {
    yield* recordMissedDecision(previous.value.id, now);
  }
  const row = yield* insertRecommendation({
    facilityId: facility.id,
    evaluatedAt,
    asOf,
    posture: snapshot.output.status.posture,
    confidence: snapshot.output.confidence.level,
    decideBy: snapshot.output.decideBy.at,
    snapshot,
  });
  return toRecord(row);
});

function replay(row: RecommendationRow): typeof replayResponse.static {
  const { input, output } = parseSnapshot(row.snapshot);
  const replayed = evaluateSnapshot(input).output;
  return {
    id: row.id,
    stored: output,
    replayed,
    matches: canonicalJson(output) === canonicalJson(replayed),
  };
}

const evaluateRequest = Effect.fn("evaluateRequest")(function* (
  decimalFacilityId: string,
  asOf: string | undefined,
) {
  const facility = yield* getFacility(decimalFacilityId);
  if (Option.isNone(facility)) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  return status(HTTP_CREATED, yield* evaluateFacility(facility.value, asOf));
});

const latestRequest = Effect.fn("latestRequest")(function* (
  decimalFacilityId: string,
) {
  const facilityId = parseDecimalId(decimalFacilityId);
  if (Option.isNone(facilityId)) {
    return recommendationNotFound();
  }
  const row = yield* findLatestRecommendation(facilityId.value);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  return toRecord(row.value);
});

/** Loads one recommendation by its decimal id and answers with `respond`, or a 404. */
const withRecommendation = Effect.fn("withRecommendation")(function* <A>(
  decimalId: string,
  respond: (row: RecommendationRow) => A,
) {
  const id = parseDecimalId(decimalId);
  if (Option.isNone(id)) {
    return recommendationNotFound();
  }
  const row = yield* findRecommendation(id.value);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  return respond(row.value);
});

export function createRecommendationsModule(runRequest: RunRequest) {
  return new Elysia({ name: "recommendations" })
    .post(
      FACILITY_RECOMMENDATIONS_PATH,
      ({ params, body }) => runRequest(evaluateRequest(params.id, body?.asOf)),
      evaluateRoute,
    )
    .get(
      LATEST_RECOMMENDATION_PATH,
      ({ params }) => runRequest(latestRequest(params.id)),
      recordRoute,
    )
    .get(
      RECOMMENDATION_PATH,
      ({ params }) => runRequest(withRecommendation(params.id, toRecord)),
      recordRoute,
    )
    .get(
      REPLAY_PATH,
      ({ params }) => runRequest(withRecommendation(params.id, replay)),
      replayRoute,
    );
}

export { RECOMMENDATIONS_PATH };
