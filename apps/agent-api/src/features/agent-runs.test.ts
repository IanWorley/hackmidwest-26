import { createTestDatabase } from "@hackmidwest/db/testing";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AgentEvent, AgentProvider } from "../providers/provider";
import { AGENT_RUNS_PATH } from "./agent-runs";

const REQUEST_ORIGIN = "http://agent-api.test";
const PROMPT = "Plan the demo";
const END_TURN = "end_turn";
const SSE_EVENT_SEPARATOR = "\n\n";
const SSE_DATA_PREFIX = "data: ";

function providerYielding(
  events: readonly AgentEvent[],
  failure?: Error,
): AgentProvider {
  return {
    async *run() {
      yield* events;
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
}

async function withApp(
  provider: AgentProvider,
  run: (app: ReturnType<typeof createApp>) => Promise<void>,
): Promise<void> {
  const store = await createTestDatabase();
  try {
    await run(createApp({ db: store.db, providers: { anthropic: provider } }));
  } finally {
    store.close();
  }
}

function startRun(): Request {
  return new Request(new URL(AGENT_RUNS_PATH, REQUEST_ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", prompt: PROMPT }),
  });
}

function getRun(id: number): Request {
  return new Request(new URL(`${AGENT_RUNS_PATH}/${id}`, REQUEST_ORIGIN));
}

/** Reads the whole stream; the run's final row is written before the stream closes. */
async function readEvents(response: Response): Promise<unknown[]> {
  const body = await response.text();
  return body
    .split(SSE_EVENT_SEPARATOR)
    .flatMap((frame) => frame.split("\n"))
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => JSON.parse(line.slice(SSE_DATA_PREFIX.length)));
}

describe(`POST ${AGENT_RUNS_PATH}`, () => {
  it("streams provider events and records the completed output", () =>
    withApp(
      providerYielding([
        { type: "text", text: "Step one. " },
        { type: "text", text: "Step two." },
        { type: "done", stopReason: END_TURN },
      ]),
      async (app) => {
        const events = await readEvents(await app.handle(startRun()));

        expect(events).toEqual([
          { type: "started", runId: 1 },
          { type: "text", text: "Step one. " },
          { type: "text", text: "Step two." },
          { type: "done", stopReason: END_TURN },
        ]);
        const run = await app.handle(getRun(1));
        expect(await run.json()).toEqual({
          id: 1,
          provider: "anthropic",
          prompt: PROMPT,
          status: "completed",
          output: "Step one. Step two.",
          stopReason: END_TURN,
        });
      },
    ));

  it("marks the run failed and keeps partial output when the provider throws", () =>
    withApp(
      providerYielding(
        [{ type: "text", text: "Partial" }],
        new Error("Provider unavailable"),
      ),
      async (app) => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const events = await readEvents(await app.handle(startRun()));

        expect(events.at(-1)).toEqual({
          type: "failed",
          message: "The agent run failed",
        });
        const run = await app.handle(getRun(1));
        expect(await run.json()).toMatchObject({
          status: "failed",
          output: "Partial",
          stopReason: null,
        });
      },
    ));
});
