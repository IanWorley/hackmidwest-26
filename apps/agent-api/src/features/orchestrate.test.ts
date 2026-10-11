import { createServer, type RequestListener } from "node:http";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { createApiClients } from "../api-client";
import { createApp } from "../app";
import type { LlmClient } from "../llm";
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
const HTTP_CREATED = 201;
const HTTP_UNPROCESSABLE_ENTITY = 422;
const FACILITY_ID = 1;
const UNKNOWN_FACILITY_ID = 99;
const RECOMMENDATION_ID = 7;
const EVALUATE_PATH = `/api/facilities/${FACILITY_ID}/recommendations`;
const UNKNOWN_EVALUATE_PATH = `/api/facilities/${UNKNOWN_FACILITY_ID}/recommendations`;
const PREVIEW_PATH = `/api/recommendations/${RECOMMENDATION_ID}/notifications/preview`;
const RATIONALE =
  "Recommend delayed arrival of 2 hours for 2026-01-14. Winter storm warning reached Severe.";
const NARRATION = "Team, we open two hours late on January 14.";
const NARRATE_DURATION_MS = 25;
const TEST_CLOCK_EPOCH = "1970-01-01T00:00:00.000Z";

const storedRecommendation = {
  id: RECOMMENDATION_ID,
  facilityId: FACILITY_ID,
  posture: "delayed_arrival",
  snapshot: { output: { rationale: RATIONALE } },
};

const notificationPreview = {
  source: { kind: "preview", recommendationId: RECOMMENDATION_ID },
  facilityDate: "2026-01-14",
  recipients: [],
  exclusions: [],
};

interface ApiReply {
  readonly status: number;
  readonly body: unknown;
}

const previewFound: ApiReply = { status: HTTP_OK, body: notificationPreview };

/** The narration takes a known time on the test clock, so its step has a non-zero duration. */
const fixedLlm: LlmClient = {
  narrate: () =>
    TestClock.adjust(NARRATE_DURATION_MS).pipe(Effect.as(NARRATION)),
};

async function withStubApi(
  previewReply: ApiReply,
  run: (
    app: ReturnType<typeof createApp>,
    requests: readonly string[],
  ) => Promise<void>,
): Promise<void> {
  const replies = new Map<string, ApiReply>([
    [
      `POST ${EVALUATE_PATH}`,
      { status: HTTP_CREATED, body: storedRecommendation },
    ],
    [
      `POST ${UNKNOWN_EVALUATE_PATH}`,
      { status: HTTP_NOT_FOUND, body: { message: "Facility not found" } },
    ],
    [`GET ${PREVIEW_PATH}`, previewReply],
  ]);
  const requests: string[] = [];
  const listener: RequestListener = (request, response) => {
    const key = `${request.method} ${request.url}`;
    requests.push(key);
    const reply = replies.get(key) ?? { status: HTTP_NOT_FOUND, body: {} };
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
  const runtime = createAgentApiRuntime(
    {
      ...createApiClients(`http://${LOOPBACK_HOST}:${address.port}`),
      llm: fixedLlm,
    },
    TestClock.layer(),
  );
  try {
    await run(createApp({ runRequest: runtime.runRequest }), requests);
  } finally {
    try {
      await runtime.dispose();
    } finally {
      server.close();
    }
  }
}

function postRun(facilityId: number | string = FACILITY_ID): Request {
  return new Request(new URL(`/facilities/${facilityId}/run`, REQUEST_ORIGIN), {
    method: "POST",
  });
}

it("returns the evaluate, preview, and narrate steps in order", () =>
  withStubApi(previewFound, async (app) => {
    const response = await app.handle(postRun());

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      facilityId: FACILITY_ID,
      recommendationId: RECOMMENDATION_ID,
      steps: [
        {
          tool: "evaluate",
          input: { facilityId: 1 },
          output: storedRecommendation,
          startedAt: TEST_CLOCK_EPOCH,
          durationMs: 0,
        },
        {
          tool: "preview_notifications",
          input: { recommendationId: RECOMMENDATION_ID },
          output: notificationPreview,
          startedAt: TEST_CLOCK_EPOCH,
          durationMs: 0,
        },
        {
          tool: "narrate",
          input: { recommendationId: RECOMMENDATION_ID },
          output: { template: RATIONALE, narrated: NARRATION },
          startedAt: TEST_CLOCK_EPOCH,
          durationMs: NARRATE_DURATION_MS,
        },
      ],
    });
  }));

it("calls only the evaluate and preview routes, never decisions or dispatch", () =>
  withStubApi(previewFound, async (app, requests) => {
    await app.handle(postRun());

    expect(requests).toEqual([`POST ${EVALUATE_PATH}`, `GET ${PREVIEW_PATH}`]);
  }));

it("passes through the API's 404 for an unknown facility", () =>
  withStubApi(previewFound, async (app) => {
    const response = await app.handle(postRun(UNKNOWN_FACILITY_ID));

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  }));

it("rejects a non-decimal id with 422 like the API", () =>
  withStubApi(previewFound, async (app, requests) => {
    const response = await app.handle(postRun("0x1"));

    expect(response.status).toBe(HTTP_UNPROCESSABLE_ENTITY);
    expect(requests).toEqual([]);
  }));

it("returns a generic 500 when the preview step fails", () =>
  withStubApi(
    {
      status: HTTP_INTERNAL_SERVER_ERROR,
      body: { message: INTERNAL_ERROR_MESSAGE },
    },
    async (app) => {
      const response = await app.handle(postRun());

      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(await response.json()).toEqual({
        message: INTERNAL_ERROR_MESSAGE,
      });
    },
  ));
