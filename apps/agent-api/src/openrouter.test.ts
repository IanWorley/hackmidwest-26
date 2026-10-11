import {
  createServer,
  type IncomingHttpHeaders,
  type RequestListener,
} from "node:http";
import { Duration, Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { NarrationPrompt } from "./llm";
import { createOpenRouterLlm } from "./openrouter";

const LOOPBACK_HOST = "127.0.0.1";
const ANY_FREE_PORT = 0;
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const API_KEY = "sk-or-test";
const MODEL = "openai/gpt-4o-mini";
const STUB_DEADLINE_MS = 50;
/** Long enough for the stub deadline to fire, short enough to fail fast if it never does. */
const NEVER_ANSWERS_TEST_BUDGET_MS = 1000;
const NEVER_ANSWERS = "never-answers";

const prompt: NarrationPrompt = {
  template: "Recommend normal operations for 2026-01-14.",
  messages: [
    { role: "system", content: "Phrase the rationale." },
    { role: "user", content: "Posture: normal" },
  ],
};

interface ReceivedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

interface OpenRouterReply {
  readonly status: number;
  readonly body: unknown;
}

async function withOpenRouter(
  reply: OpenRouterReply | typeof NEVER_ANSWERS,
  run: (
    narrate: (prompt: NarrationPrompt) => Promise<unknown>,
    received: ReceivedRequest[],
  ) => Promise<void>,
): Promise<void> {
  const received: ReceivedRequest[] = [];
  const listener: RequestListener = async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    received.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    if (reply === NEVER_ANSWERS) {
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
    throw new Error("Expected the stub OpenRouter to listen on a TCP port");
  }
  const llm = createOpenRouterLlm({
    baseUrl: `http://${LOOPBACK_HOST}:${address.port}/api/v1`,
    apiKey: API_KEY,
    model: MODEL,
    timeout: Duration.millis(STUB_DEADLINE_MS),
  });
  function narrate(input: NarrationPrompt): Promise<unknown> {
    return Effect.runPromise(
      llm.narrate(input).pipe(
        Effect.match({
          onSuccess: (narrated) => ({ narrated }),
          onFailure: (error) => ({ tag: error._tag, cause: error.cause }),
        }),
      ),
    );
  }
  try {
    await run(narrate, received);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

describe("createOpenRouterLlm", () => {
  it("posts the prompt to chat completions and returns the reply's message", () =>
    withOpenRouter(
      {
        status: HTTP_OK,
        body: { choices: [{ message: { content: "Open as usual." } }] },
      },
      async (narrate, received) => {
        expect(await narrate(prompt)).toEqual({ narrated: "Open as usual." });
        expect(received).toMatchObject([
          {
            method: "POST",
            url: "/api/v1/chat/completions",
            headers: {
              authorization: "Bearer sk-or-test",
              "content-type": "application/json",
              "http-referer": "https://github.com/IanWorley/hackmidwest-26",
              "x-title": "Closure Call",
            },
            body: {
              model: "openai/gpt-4o-mini",
              messages: [
                { role: "system", content: "Phrase the rationale." },
                { role: "user", content: "Posture: normal" },
              ],
            },
          },
        ]);
      },
    ));

  it("fails with LlmError when OpenRouter answers with an error status", () =>
    withOpenRouter(
      {
        status: HTTP_TOO_MANY_REQUESTS,
        body: { error: { message: "Rate limit exceeded" } },
      },
      async (narrate) => {
        expect(await narrate(prompt)).toEqual({
          tag: "LlmError",
          cause: "OpenRouter answered 429",
        });
      },
    ));

  it("fails with LlmError when the reply has no message content", () =>
    withOpenRouter(
      { status: HTTP_OK, body: { choices: [] } },
      async (narrate) => {
        expect(await narrate(prompt)).toEqual({
          tag: "LlmError",
          cause: "OpenRouter reply has no message content",
        });
      },
    ));

  it(
    "fails with LlmError when OpenRouter does not answer within the deadline",
    () =>
      withOpenRouter(NEVER_ANSWERS, async (narrate) => {
        expect(await narrate(prompt)).toEqual({
          tag: "LlmError",
          cause: "OpenRouter did not answer in time",
        });
      }),
    NEVER_ANSWERS_TEST_BUDGET_MS,
  );
});
