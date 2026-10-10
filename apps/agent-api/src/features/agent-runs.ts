import { agentRuns, type Database } from "@hackmidwest/db";
import { eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Elysia, t } from "elysia";
import {
  type AgentEvent,
  type AgentProvider,
  type AgentRunRequest,
  PROVIDER_IDS,
  type ProviderRegistry,
} from "../providers/provider";

export const AGENT_RUNS_PATH = "/api/agent-runs";
export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
const PROMPT_LENGTH = { min: 1, max: 100_000 } as const;
// Clients get a stable message; the cause is logged server-side.
const RUN_FAILED_MESSAGE = "The agent run failed";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
} as const;

type AgentRunStatus = (typeof agentRuns.$inferSelect)["status"];

/** Every SSE frame's event name is its `type`; the data is the whole event as JSON. */
type AgentRunStreamEvent =
  | { readonly type: "started"; readonly runId: number }
  | AgentEvent
  | { readonly type: "failed"; readonly message: string };

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const agentRunResponse = createSelectSchema(agentRuns);

const createAgentRunBody = t.Object(
  {
    provider: t.UnionEnum(PROVIDER_IDS),
    prompt: t.String({
      minLength: PROMPT_LENGTH.min,
      maxLength: PROMPT_LENGTH.max,
    }),
  },
  { additionalProperties: false },
);

/** Streams provider events as SSE and records the run, including partial output on failure. */
export function createAgentRunsModule(
  db: Database,
  providers: ProviderRegistry,
) {
  return new Elysia({ name: "agent-runs" })
    .post(
      AGENT_RUNS_PATH,
      async ({ body, request }) => {
        const [run] = await db
          .insert(agentRuns)
          .values(body)
          .returning({ id: agentRuns.id });
        if (run === undefined) {
          throw new Error("Agent run insert did not return its row");
        }
        const events = streamRun(
          db,
          run.id,
          providers[body.provider],
          body,
          request.signal,
        );
        return new Response(toSseStream(events), { headers: SSE_HEADERS });
      },
      { body: createAgentRunBody },
    )
    .get(
      `${AGENT_RUNS_PATH}/:id`,
      async ({ params, status }) => {
        const [run] = await db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.id, params.id));
        return run ?? status(HTTP_NOT_FOUND, "Agent run not found");
      },
      {
        params: t.Object({ id: t.Numeric() }),
        response: { [HTTP_OK]: agentRunResponse, [HTTP_NOT_FOUND]: t.String() },
      },
    );
}

async function* streamRun(
  db: Database,
  runId: number,
  provider: AgentProvider,
  request: AgentRunRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentRunStreamEvent> {
  let output = "";
  let stopReason: string | null = null;
  let status: AgentRunStatus = "failed";
  try {
    yield { type: "started", runId };
    for await (const event of provider.run(request, signal)) {
      if (event.type === "text") {
        output += event.text;
      } else {
        stopReason = event.stopReason;
        status = "completed";
      }
      yield event;
    }
  } catch (error) {
    console.error(`Agent run ${runId} failed`, error);
    yield { type: "failed", message: RUN_FAILED_MESSAGE };
  } finally {
    // Also runs when the client disconnects and the stream is cancelled.
    await db
      .update(agentRuns)
      .set({ status, output, stopReason })
      .where(eq(agentRuns.id, runId));
  }
}

/**
 * Encodes to bytes here because Elysia's own SSE path enqueues strings,
 * which Bun accepts but Node (where Vitest runs) rejects.
 */
function toSseStream(
  events: AsyncGenerator<AgentRunStreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const next = await events.next();
      if (next.done) {
        controller.close();
        return;
      }
      const event = next.value;
      controller.enqueue(
        encoder.encode(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        ),
      );
    },
    // A client disconnect cancels the stream; returning the generator runs its finally.
    async cancel() {
      await events.return(undefined);
    },
  });
}
