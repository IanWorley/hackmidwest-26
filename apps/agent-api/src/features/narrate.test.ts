import { createServer, type RequestListener } from "node:http";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { createApiClients } from "../api-client";
import { createApp } from "../app";
import {
  type LlmClient,
  LlmError,
  type NarrationPrompt,
  templateLlm,
} from "../llm";
import {
  createAgentApiRuntime,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  INTERNAL_ERROR_MESSAGE,
} from "../runtime";

const REQUEST_ORIGIN = "http://agent-api.test";
const LOOPBACK_HOST = "127.0.0.1";
const ANY_FREE_PORT = 0;
const HTTP_UNPROCESSABLE_ENTITY = 422;
const RECOMMENDATION_ID = 7;
const RECOMMENDATION_PATH = `/api/recommendations/${RECOMMENDATION_ID}`;
const NARRATE_URL = `/recommendations/${RECOMMENDATION_ID}/narrate`;
const RATIONALE =
  "Recommend delayed arrival of 2 hours for 2026-01-14. Winter storm warning reached Severe.";
const NARRATION = "Team, we open two hours late on January 14.";
const POSTURE_CHOICE_WORDS = /\b(?:choose|select|pick|decide)\b/iu;

const storedRecommendation = {
  id: RECOMMENDATION_ID,
  posture: "delayed_arrival",
  snapshot: { output: { rationale: RATIONALE } },
};

interface ApiReply {
  readonly status: number;
  readonly body: unknown;
}

const found: ApiReply = { status: HTTP_OK, body: storedRecommendation };

async function withRecommendationsApi(
  reply: ApiReply,
  llm: LlmClient,
  run: (app: ReturnType<typeof createApp>) => Promise<void>,
): Promise<void> {
  const listener: RequestListener = (request, response) => {
    if (request.method !== "GET" || request.url !== RECOMMENDATION_PATH) {
      response.writeHead(HTTP_NOT_FOUND).end();
      return;
    }
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  };
  const server = createServer(listener);
  await new Promise<void>((resolve) =>
    server.listen(ANY_FREE_PORT, LOOPBACK_HOST, resolve),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the stub API to listen on a TCP port");
  }
  const runtime = createAgentApiRuntime({
    ...createApiClients(`http://${LOOPBACK_HOST}:${address.port}`),
    llm,
  });
  try {
    await run(createApp({ runRequest: runtime.runRequest }));
  } finally {
    try {
      await runtime.dispose();
    } finally {
      server.close();
    }
  }
}

function postNarrate(path = NARRATE_URL): Request {
  return new Request(new URL(path, REQUEST_ORIGIN), { method: "POST" });
}

const fixedLlm: LlmClient = { narrate: () => Effect.succeed(NARRATION) };

it("returns the stored rationale beside the model's narration", () =>
  withRecommendationsApi(found, fixedLlm, async (app) => {
    const response = await app.handle(postNarrate());

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      template: RATIONALE,
      narrated: NARRATION,
    });
  }));

it("returns the rationale unchanged as the narration when no model is configured", () =>
  withRecommendationsApi(found, templateLlm, async (app) => {
    const response = await app.handle(postNarrate());

    expect(await response.json()).toEqual({
      template: RATIONALE,
      narrated: RATIONALE,
    });
  }));

it("gives the model the stored posture as fixed input and never asks it to choose one", async () => {
  const prompts: NarrationPrompt[] = [];
  const recordingLlm: LlmClient = {
    narrate: (prompt) => {
      prompts.push(prompt);
      return Effect.succeed(NARRATION);
    },
  };

  await withRecommendationsApi(found, recordingLlm, async (app) => {
    await app.handle(postNarrate());
  });

  const promptText = prompts
    .flatMap(({ messages }) => messages.map(({ content }) => content))
    .join("\n");
  expect(promptText).toContain("Posture: delayed_arrival");
  expect(promptText).toContain(RATIONALE);
  expect(promptText).not.toMatch(POSTURE_CHOICE_WORDS);
});

it("passes through the API's 404 for an unknown recommendation", () =>
  withRecommendationsApi(
    {
      status: HTTP_NOT_FOUND,
      body: { message: "Recommendation not found" },
    },
    fixedLlm,
    async (app) => {
      const response = await app.handle(postNarrate());

      expect(response.status).toBe(HTTP_NOT_FOUND);
      expect(await response.json()).toEqual({
        message: "Recommendation not found",
      });
    },
  ));

it("rejects a non-decimal id with 422 like the API", () =>
  withRecommendationsApi(found, fixedLlm, async (app) => {
    const response = await app.handle(
      postNarrate("/recommendations/0x7/narrate"),
    );

    expect(response.status).toBe(HTTP_UNPROCESSABLE_ENTITY);
  }));

it("returns a generic 500 when the API fails", () =>
  withRecommendationsApi(
    {
      status: HTTP_INTERNAL_SERVER_ERROR,
      body: { message: INTERNAL_ERROR_MESSAGE },
    },
    fixedLlm,
    async (app) => {
      const response = await app.handle(postNarrate());

      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(await response.json()).toEqual({
        message: INTERNAL_ERROR_MESSAGE,
      });
    },
  ));

it("returns a generic 500 when the model fails", () =>
  withRecommendationsApi(
    found,
    { narrate: () => Effect.fail(new LlmError({ cause: "rate limited" })) },
    async (app) => {
      const response = await app.handle(postNarrate());

      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(await response.json()).toEqual({
        message: INTERNAL_ERROR_MESSAGE,
      });
    },
  ));
