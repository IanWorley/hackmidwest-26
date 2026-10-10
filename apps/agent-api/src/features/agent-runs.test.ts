import { agentRuns, type Database } from "@hackmidwest/db";
import { createTestDatabase } from "@hackmidwest/db/testing";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AgentProvider, AgentRunEnd } from "../providers/provider";
import { AGENT_RUNS_PATH, failOrphanedRuns } from "./agent-runs";

const REQUEST_ORIGIN = "http://agent-api.test";
const PROMPT = "Plan the demo";
const SSE_DATA_PREFIX = "data: ";
const COMPLETED: AgentRunEnd = { status: "completed", stopReason: "end_turn" };

type TestContext = {
  readonly app: ReturnType<typeof createApp>;
  readonly db: Database;
};

function providerYielding(
  chunks: readonly string[],
  ending: AgentRunEnd | Error,
): AgentProvider {
  return {
    async *run() {
      yield* chunks;
      if (ending instanceof Error) {
        throw ending;
      }
      return ending;
    },
  };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
}

async function withApp(
  provider: AgentProvider,
  run: (context: TestContext) => Promise<void>,
): Promise<void> {
  const store = await createTestDatabase();
  try {
    const app = createApp({ db: store.db, providers: { anthropic: provider } });
    await run({ app, db: store.db });
  } finally {
    store.close();
  }
}

function startRun(signal?: AbortSignal): Request {
  return new Request(new URL(AGENT_RUNS_PATH, REQUEST_ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", prompt: PROMPT }),
    ...(signal === undefined ? {} : { signal }),
  });
}

async function getRun(app: TestContext["app"], id: number): Promise<unknown> {
  const response = await app.handle(
    new Request(new URL(`${AGENT_RUNS_PATH}/${id}`, REQUEST_ORIGIN)),
  );
  return response.json();
}

async function readEvents(response: Response): Promise<unknown[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => JSON.parse(line.slice(SSE_DATA_PREFIX.length)));
}

describe(`POST ${AGENT_RUNS_PATH}`, () => {
  it("streams the provider's output to the client", () =>
    withApp(
      providerYielding(["Step one. ", "Step two."], COMPLETED),
      async ({ app }) => {
        const events = await readEvents(await app.handle(startRun()));

        expect(events).toEqual([
          { type: "started", runId: 1 },
          { type: "text", text: "Step one. " },
          { type: "text", text: "Step two." },
          { type: "done", status: "completed", stopReason: "end_turn" },
        ]);
      },
    ));

  it.each([
    { status: "completed", stopReason: "end_turn" },
    { status: "refused", stopReason: "refusal" },
  ] as const)("records a run that ends $status", (ending) =>
    withApp(providerYielding(["Step one."], ending), async ({ app }) => {
      await readEvents(await app.handle(startRun()));

      expect(await getRun(app, 1)).toEqual({
        id: 1,
        provider: "anthropic",
        prompt: PROMPT,
        output: "Step one.",
        ...ending,
      });
    }),
  );

  it("tells the client a run failed without exposing the cause", () =>
    withApp(
      providerYielding([], new Error("Provider unavailable")),
      async ({ app }) => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const events = await readEvents(await app.handle(startRun()));

        expect(events.at(-1)).toEqual({
          type: "failed",
          message: "The agent run failed",
        });
      },
    ));

  it("records a failed run with its partial output", () =>
    withApp(
      providerYielding(["Partial"], new Error("Provider unavailable")),
      async ({ app }) => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await readEvents(await app.handle(startRun()));

        expect(await getRun(app, 1)).toMatchObject({
          status: "failed",
          output: "Partial",
          stopReason: null,
        });
      },
    ));

  it("records a disconnect while the provider is working as cancelled", () => {
    let markWaiting = () => {};
    const providerWaiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    return withApp(
      {
        async *run(_request, signal) {
          yield "Partial";
          markWaiting();
          return await waitForAbort(signal);
        },
      },
      async ({ app }) => {
        const disconnect = new AbortController();
        const response = await app.handle(startRun(disconnect.signal));
        const drained = response.text();

        await providerWaiting;
        disconnect.abort();
        await drained;

        expect(await getRun(app, 1)).toMatchObject({
          status: "cancelled",
          output: "Partial",
        });
      },
    );
  });

  it("records a disconnect between chunks as cancelled", () =>
    withApp(
      providerYielding(["Partial", "never read"], COMPLETED),
      async ({ app }) => {
        const response = await app.handle(startRun());
        const reader = response.body?.getReader();

        await reader?.read();
        await reader?.cancel();

        expect(await getRun(app, 1)).toMatchObject({ status: "cancelled" });
      },
    ));
});

describe("failOrphanedRuns", () => {
  it("fails runs left running by a previous process", () =>
    withApp(providerYielding([], COMPLETED), async ({ app, db }) => {
      await db
        .insert(agentRuns)
        .values({ provider: "anthropic", prompt: PROMPT });

      await failOrphanedRuns(db);

      expect(await getRun(app, 1)).toMatchObject({ status: "failed" });
    }));
});
