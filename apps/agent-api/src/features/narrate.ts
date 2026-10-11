import { Data, Effect } from "effect";
import { Elysia, status, t } from "elysia";
import type { NarrationPrompt } from "../llm";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  Llm,
  type RunRequest,
  TasksApi,
} from "../runtime";
import type { TasksApiClient } from "../tasks-api";

const NARRATE_PATH = "/recommendations/:id/narrate";
const HTTP_NOT_FOUND = 404;
/** Mirrors apps/api's decimal id route params, so a malformed id gets the same 422 and never reaches the API. */
const DECIMAL_ID_PATTERN = "^[1-9][0-9]*$";

const NARRATION_INSTRUCTIONS = [
  "You rewrite a weather operating-status recommendation as the body of a short email from a federal facility manager to staff.",
  "The operating posture is already decided and is given as fixed input. State it as given.",
  "Keep every time, threshold, reading, and source the rationale names. Do not add facts.",
  "Reply with the email body only.",
].join(" ");

const narrateParams = t.Object({
  id: t.String({ pattern: DECIMAL_ID_PATTERN }),
});

const narrationResponse = t.Object({
  template: t.String(),
  narrated: t.String(),
});

const notFoundResponse = t.Object({ message: t.String() });

class RecommendationReadError extends Data.TaggedError(
  "RecommendationReadError",
)<{
  readonly cause: unknown;
}> {}

type RecommendationRecord = NonNullable<
  Awaited<
    ReturnType<ReturnType<TasksApiClient["api"]["recommendations"]>["get"]>
  >["data"]
>;

interface StoredRecommendation {
  readonly posture: RecommendationRecord["posture"];
  readonly rationale: string;
}

function narrationPrompt({
  posture,
  rationale,
}: StoredRecommendation): NarrationPrompt {
  return {
    template: rationale,
    messages: [
      { role: "system", content: NARRATION_INSTRUCTIONS },
      {
        role: "user",
        content: `Posture: ${posture}\n\nRationale:\n${rationale}`,
      },
    ],
  };
}

const narrate = Effect.fn("narrate")(function* (decimalId: string) {
  const tasksApi = yield* TasksApi;
  const result = yield* Effect.tryPromise({
    try: (signal) =>
      tasksApi.api
        .recommendations({ id: decimalId })
        .get({ fetch: { signal } }),
    catch: (cause) => new RecommendationReadError({ cause }),
  });
  if (result.error?.status === HTTP_NOT_FOUND) {
    return status(HTTP_NOT_FOUND, result.error.value);
  }
  if (result.error !== null) {
    return yield* Effect.fail(
      new RecommendationReadError({ cause: result.error.value }),
    );
  }
  const prompt = narrationPrompt({
    posture: result.data.posture,
    rationale: result.data.snapshot.output.rationale,
  });
  const llm = yield* Llm;
  return { template: prompt.template, narrated: yield* llm.narrate(prompt) };
});

export function createNarrateModule(runRequest: RunRequest) {
  return new Elysia({ name: "narrate" }).post(
    NARRATE_PATH,
    ({ params }) => runRequest(narrate(params.id)),
    {
      params: narrateParams,
      response: {
        [HTTP_OK]: narrationResponse,
        [HTTP_NOT_FOUND]: notFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { NARRATE_PATH };
