import type { TSchema } from "@sinclair/typebox";
import { DateTime, Duration, Effect } from "effect";
import { Elysia, status, t } from "elysia";
import type { NotificationPackage, RecommendationRecord } from "../api-client";
import {
  ClosureApi,
  decimalIdParams,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  notFoundResponse,
  type RunRequest,
} from "../runtime";
import { narrateRecommendation, narrationResponse } from "./narrate";

const RUN_PATH = "/facilities/:id/run";
const EVALUATE_TOOL = "evaluate";
const PREVIEW_TOOL = "preview_notifications";
const NARRATE_TOOL = "narrate";

function stepSchema<
  Tool extends string,
  Input extends TSchema,
  Output extends TSchema,
>(tool: Tool, input: Input, output: Output) {
  return t.Object({
    tool: t.Literal(tool),
    input,
    output,
    startedAt: t.String({ format: "date-time" }),
    durationMs: t.Integer({ minimum: 0 }),
  });
}

const recommendationInput = t.Object({ recommendationId: t.Integer() });

/**
 * The agent API sees the API's response types but not its schemas, so step outputs are typed for
 * Eden callers and left unchecked at runtime. apps/api already validated them on the way out.
 */
const runLogResponse = t.Object({
  facilityId: t.Integer(),
  recommendationId: t.Integer(),
  steps: t.Tuple([
    stepSchema(
      EVALUATE_TOOL,
      t.Object({ facilityId: t.String() }),
      t.Unsafe<RecommendationRecord>(t.Unknown()),
    ),
    stepSchema(
      PREVIEW_TOOL,
      recommendationInput,
      t.Unsafe<NotificationPackage>(t.Unknown()),
    ),
    stepSchema(NARRATE_TOOL, recommendationInput, narrationResponse),
  ]),
});

type RunLog = typeof runLogResponse.static;

/** Effect.timed reads the monotonic clock, so a wall-clock correction mid-step cannot skew the duration. */
function step<Tool extends string, Input, Output, E, R>(
  tool: Tool,
  input: Input,
  run: Effect.Effect<Output, E, R>,
) {
  return Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const [duration, output] = yield* Effect.timed(run);
    return {
      tool,
      input,
      output,
      startedAt,
      durationMs: Math.floor(Duration.toMillis(duration)),
    };
  });
}

/** The posture comes only from the evaluate step's stored recommendation. Nothing here asks the model for one. */
const runFacility = Effect.fn("runFacility")(
  function* (decimalFacilityId: string) {
    const closureApi = yield* ClosureApi;
    const evaluate = yield* step(
      EVALUATE_TOOL,
      { facilityId: decimalFacilityId },
      closureApi.evaluate(decimalFacilityId),
    );
    const recommendation = evaluate.output;
    const preview = yield* step(
      PREVIEW_TOOL,
      { recommendationId: recommendation.id },
      closureApi.previewNotifications(recommendation.id),
    );
    const narrate = yield* step(
      NARRATE_TOOL,
      { recommendationId: recommendation.id },
      narrateRecommendation(recommendation),
    );
    const log: RunLog = {
      facilityId: recommendation.facilityId,
      recommendationId: recommendation.id,
      steps: [evaluate, preview, narrate],
    };
    return log;
  },
  Effect.catchTag("NotFoundError", ({ message }) =>
    Effect.succeed(status(HTTP_NOT_FOUND, { message })),
  ),
);

export function createOrchestrateModule(runRequest: RunRequest) {
  return new Elysia({ name: "orchestrate" }).post(
    RUN_PATH,
    ({ params }) => runRequest(runFacility(params.id)),
    {
      params: decimalIdParams,
      response: {
        [HTTP_OK]: runLogResponse,
        [HTTP_NOT_FOUND]: notFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}
