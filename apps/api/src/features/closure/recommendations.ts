import { Clock, Effect, Option } from "effect";
import { Elysia, type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { GeoPoint } from "../../clients/nws-model";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  NwsClient,
  OpenMeteoClient,
  type RunRequest,
} from "../../runtime";
import { decimalIdParams } from "../decimal-id";
import { type EngineInput, evaluatePosture } from "./engine";
import {
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  type Facility,
  facilityNotFoundResponse,
  getFacility,
} from "./facilities";
import { airQualityReadings, observationReadings } from "./readings";
import {
  parseAs,
  RecommendationSchema,
  SnapshotSchema,
} from "./recommendation-schema";
import {
  findLatestRecommendation,
  findRecommendation,
  insertRecommendation,
  RecommendationRecordSchema,
  type RecommendationRow,
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
    /** Evaluate the data pulled now as of this instant instead of the clock reading. */
    asOf: t.Optional(t.String({ format: "date-time" })),
  }),
);

const replayResponse = t.Object({
  id: t.Integer(),
  stored: RecommendationSchema,
  replayed: RecommendationSchema,
  matches: t.Boolean(),
});

const recommendationNotFoundResponse = t.Object({
  message: t.Literal(RECOMMENDATION_NOT_FOUND_MESSAGE),
});

const replayRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: replayResponse,
    [HTTP_NOT_FOUND]: recommendationNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

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

type NotFound<Body extends { readonly static: unknown }> =
  ElysiaCustomStatusResponse<typeof HTTP_NOT_FOUND, Body["static"]>;

function facilityNotFound(): NotFound<typeof facilityNotFoundResponse> {
  return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
}

function recommendationNotFound(): NotFound<
  typeof recommendationNotFoundResponse
> {
  return status(HTTP_NOT_FOUND, { message: RECOMMENDATION_NOT_FOUND_MESSAGE });
}

/** Exactly the facility fields the engine reads, so the snapshot holds what drove the result and nothing else. */
function engineFacility(facility: Facility): EngineInput["facility"] {
  return {
    timezone: facility.timezone,
    opensAt: facility.opensAt,
    closesAt: facility.closesAt,
    arrivalWindowStart: facility.arrivalWindowStart,
    arrivalWindowEnd: facility.arrivalWindowEnd,
    typicalCommuteMinutes: facility.typicalCommuteMinutes,
    roadClass: facility.roadClass,
    decisionDeadline: facility.decisionDeadline,
    hazardProfile: facility.hazards,
  };
}

const pullConditions = Effect.fn("pullConditions")(function* (point: GeoPoint) {
  const nws = yield* NwsClient;
  const openMeteo = yield* OpenMeteoClient;
  return yield* Effect.all(
    {
      alerts: nws.activeAlerts(point),
      forecast: nws.hourlyForecast(point),
      observation: nws.latestObservation(point),
      airQuality: openMeteo.currentAqi(point),
    },
    { concurrency: "unbounded" },
  );
});

const evaluateFacility = Effect.fn("evaluateFacility")(function* (
  facility: Facility,
  requestedAsOf: string | undefined,
) {
  const evaluatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  let asOf = evaluatedAt;
  if (requestedAsOf !== undefined) {
    asOf = new Date(requestedAsOf).toISOString();
  }
  const { alerts, forecast, observation, airQuality } = yield* pullConditions({
    lat: facility.latitude,
    lon: facility.longitude,
  });
  const input: EngineInput = {
    now: asOf,
    facility: engineFacility(facility),
    readings: [
      ...observationReadings(observation),
      ...airQualityReadings(airQuality),
    ],
    alerts,
    forecast,
  };
  // Checked before the insert, so every stored snapshot is one the read routes can parse.
  const snapshot = yield* parseAs(SnapshotSchema, {
    input,
    output: evaluatePosture(input),
  });
  return yield* insertRecommendation({
    facilityId: facility.id,
    evaluatedAt,
    asOf,
    posture: snapshot.output.status.posture,
    confidence: snapshot.output.confidence,
    decideBy: snapshot.output.decideBy,
    snapshot,
  });
});

const replay = Effect.fn("replay")(function* (row: RecommendationRow) {
  const { input, output } = yield* parseAs(SnapshotSchema, row.snapshot);
  const replayed = yield* parseAs(RecommendationSchema, evaluatePosture(input));
  return {
    id: row.id,
    stored: output,
    replayed,
    matches: canonicalJson(output) === canonicalJson(replayed),
  };
});

const evaluateRequest = Effect.fn("evaluateRequest")(function* (
  decimalFacilityId: string,
  asOf: string | undefined,
) {
  const facility = yield* getFacility(decimalFacilityId);
  if (Option.isNone(facility)) {
    return facilityNotFound();
  }
  return status(HTTP_CREATED, yield* evaluateFacility(facility.value, asOf));
});

const latestRequest = Effect.fn("latestRequest")(function* (
  decimalFacilityId: string,
) {
  const row = yield* findLatestRecommendation(decimalFacilityId);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  return yield* toRecord(row.value);
});

const recordRequest = Effect.fn("recordRequest")(function* (decimalId: string) {
  const row = yield* findRecommendation(decimalId);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  return yield* toRecord(row.value);
});

const replayRequest = Effect.fn("replayRequest")(function* (decimalId: string) {
  const row = yield* findRecommendation(decimalId);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  return yield* replay(row.value);
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
      ({ params }) => runRequest(recordRequest(params.id)),
      recordRoute,
    )
    .get(
      REPLAY_PATH,
      ({ params }) => runRequest(replayRequest(params.id)),
      replayRoute,
    );
}

export { RECOMMENDATIONS_PATH };
