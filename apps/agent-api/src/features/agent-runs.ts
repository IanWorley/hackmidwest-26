import {
  AGENT_RUN_PROMPT_LENGTH,
  type AgentRunStatus,
  agentRuns,
  type Database,
} from "@hackmidwest/db";
import { eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Elysia, t } from "elysia";
import {
  type AgentProvider,
  type AgentRunEnd,
  type AgentRunRequest,
  PROVIDER_IDS,
  type ProviderRegistry,
} from "../providers/provider";

export const AGENT_RUNS_PATH = "/api/agent-runs";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
// Clients get a stable message; the cause is logged server-side.
const RUN_FAILED_MESSAGE = "The agent run failed";
// Thinking and refusal fallbacks can leave the stream silent past Bun's 30 s idle timeout.
const NO_IDLE_TIMEOUT = 0;

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
} as const;

type RunEnd = {
  readonly status: Exclude<AgentRunStatus, "running">;
  readonly stopReason: string | null;
};
const CANCELLED: RunEnd = { status: "cancelled", stopReason: null };
const FAILED: RunEnd = { status: "failed", stopReason: null };

/** Every SSE frame's event name is its `type`; the data is the whole event as JSON. */
type AgentRunStreamEvent =
  | { readonly type: "started"; readonly runId: number }
  | { readonly type: "text"; readonly text: string }
  | ({ readonly type: "done" } & AgentRunEnd)
  | { readonly type: "failed"; readonly message: string };

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const agentRunResponse = createSelectSchema(agentRuns);

const createAgentRunBody = t.Object(
  {
    provider: t.UnionEnum(PROVIDER_IDS),
    prompt: t.String({
      minLength: AGENT_RUN_PROMPT_LENGTH.min,
      maxLength: AGENT_RUN_PROMPT_LENGTH.max,
    }),
  },
  { additionalProperties: false },
);

/** This process is the only one that streams runs, so at startup every `running` row is orphaned. */
export async function failInterruptedRuns(db: Database): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: FAILED.status })
    .where(eq(agentRuns.status, "running"));
}

/** Streams provider output as SSE and records how each run ended, with whatever output arrived. */
export function createAgentRunsModule(
  db: Database,
  providers: ProviderRegistry,
) {
  return new Elysia({ name: "agent-runs" })
    .post(
      AGENT_RUNS_PATH,
      async ({ body, request, server }) => {
        const [run] = await db
          .insert(agentRuns)
          .values(body)
          .returning({ id: agentRuns.id });
        if (run === undefined) {
          throw new Error("Agent run insert did not return its row");
        }
        server?.timeout(request, NO_IDLE_TIMEOUT);
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

/** Ends as cancelled unless the provider finishes or fails first; a client disconnect is neither. */
async function* streamRun(
  db: Database,
  runId: number,
  provider: AgentProvider,
  request: AgentRunRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentRunStreamEvent> {
  let output = "";
  let end = CANCELLED;
  try {
    yield { type: "started", runId };
    const chunks = provider.run(request, signal);
    for (let step = await chunks.next(); ; step = await chunks.next()) {
      if (step.done) {
        end = step.value;
        yield { type: "done", ...step.value };
        return;
      }
      output += step.value;
      yield { type: "text", text: step.value };
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    end = FAILED;
    console.error(`Agent run ${runId} failed`, error);
    yield { type: "failed", message: RUN_FAILED_MESSAGE };
  } finally {
    await db
      .update(agentRuns)
      .set({ status: end.status, output, stopReason: end.stopReason })
      .where(eq(agentRuns.id, runId));
  }
}

/**
 * Elysia's streaming path does not await generator cleanup on cancel, and its sse() enqueues
 * strings, which Node rejects. Here cancel resolves only after the run's row is written.
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
    async cancel() {
      await events.return(undefined);
    },
  });
}
