import { Effect } from "effect";
import { Elysia, status, t } from "elysia";
import type { RecommendationRecord } from "../api-client";
import type { NarrationPrompt } from "../llm";
import {
  ClosureApi,
  decimalIdParams,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  Llm,
  notFoundResponse,
  type RunRequest,
} from "../runtime";

const NARRATE_PATH = "/recommendations/:id/narrate";

const NARRATION_INSTRUCTIONS = [
  "You rewrite a weather operating-status recommendation as the body of a short email from a federal facility manager to staff.",
  "The operating posture is already decided and is given as fixed input. State it as given.",
  "Keep every time, threshold, reading, and source the rationale names. Do not add facts.",
  "Reply with the email body only.",
].join(" ");

const narrationResponse = t.Object({
  template: t.String(),
  narrated: t.String(),
});

function narrationPrompt({
  posture,
  snapshot,
}: RecommendationRecord): NarrationPrompt {
  const { rationale } = snapshot.output;
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

/** Phrases a stored recommendation. The posture is the stored one; the model only rewrites its rationale. */
const narrateRecommendation = Effect.fn("narrateRecommendation")(function* (
  recommendation: RecommendationRecord,
) {
  const prompt = narrationPrompt(recommendation);
  const llm = yield* Llm;
  return { template: prompt.template, narrated: yield* llm.narrate(prompt) };
});

const narrate = Effect.fn("narrate")(
  function* (decimalRecommendationId: string) {
    const closureApi = yield* ClosureApi;
    const recommendation = yield* closureApi.readRecommendation(
      decimalRecommendationId,
    );
    return yield* narrateRecommendation(recommendation);
  },
  Effect.catchTag("NotFoundError", ({ message }) =>
    Effect.succeed(status(HTTP_NOT_FOUND, { message })),
  ),
);

export function createNarrateModule(runRequest: RunRequest) {
  return new Elysia({ name: "narrate" }).post(
    NARRATE_PATH,
    ({ params }) => runRequest(narrate(params.id)),
    {
      params: decimalIdParams,
      response: {
        [HTTP_OK]: narrationResponse,
        [HTTP_NOT_FOUND]: notFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { NARRATE_PATH, narrateRecommendation, narrationResponse };
