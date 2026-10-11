import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { ClosureApiClient, TasksApiClient } from "./api-client";
import type { LlmClient } from "./llm";

type InternalServerFailure = ElysiaCustomStatusResponse<
  typeof HTTP_INTERNAL_SERVER_ERROR,
  typeof internalServerErrorResponse.static
>;

/** Mirrors apps/api's decimal id route params, so a malformed id gets the same 422 and never reaches the API. */
const DECIMAL_ID_PATTERN = "^[1-9][0-9]*$";

interface AgentApiPorts {
  readonly closureApi: ClosureApiClient;
  readonly tasksApi: TasksApiClient;
  readonly llm: LlmClient;
}

function agentApiLayer({ closureApi, tasksApi, llm }: AgentApiPorts) {
  return Layer.mergeAll(
    Layer.succeed(ClosureApi, closureApi),
    Layer.succeed(TasksApi, tasksApi),
    Layer.succeed(Llm, llm),
  );
}

export class ClosureApi extends Context.Service<ClosureApi, ClosureApiClient>()(
  "@hackmidwest/agent-api/ClosureApi",
) {}

export class TasksApi extends Context.Service<TasksApi, TasksApiClient>()(
  "@hackmidwest/agent-api/TasksApi",
) {}

export class Llm extends Context.Service<Llm, LlmClient>()(
  "@hackmidwest/agent-api/Llm",
) {}

export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

export const decimalIdParams = t.Object({
  id: t.String({ pattern: DECIMAL_ID_PATTERN }),
});

export const notFoundResponse = t.Object({ message: t.String() });

export const internalServerErrorResponse = t.Object({
  message: t.Literal(INTERNAL_ERROR_MESSAGE),
});

export type AgentApiServices = Layer.Success<ReturnType<typeof agentApiLayer>>;

export type RunRequest = <A, E>(
  program: Effect.Effect<A, E, AgentApiServices>,
) => Promise<A | InternalServerFailure>;

export interface AgentApiRuntime {
  readonly runRequest: RunRequest;
  readonly dispose: () => Promise<void>;
}

/** `clock` lets tests pass `TestClock.layer()` so the run log's timings are deterministic. */
export function createAgentApiRuntime(
  ports: AgentApiPorts,
  clock: Layer.Layer<never> = Layer.empty,
): AgentApiRuntime {
  const runtime = ManagedRuntime.make(Layer.merge(agentApiLayer(ports), clock));
  return {
    runRequest: (program) =>
      runtime.runPromise(
        program.pipe(
          Effect.catchCause((cause) =>
            Effect.logError(cause).pipe(
              Effect.as(
                status(HTTP_INTERNAL_SERVER_ERROR, {
                  message: INTERNAL_ERROR_MESSAGE,
                }),
              ),
            ),
          ),
        ),
      ),
    dispose: () => runtime.dispose(),
  };
}
