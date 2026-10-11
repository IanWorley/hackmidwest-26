import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { LlmClient } from "./llm";
import type { TasksApiClient } from "./tasks-api";

type InternalServerFailure = ElysiaCustomStatusResponse<
  typeof HTTP_INTERNAL_SERVER_ERROR,
  typeof internalServerErrorResponse.static
>;

function agentApiLayer(tasksApi: TasksApiClient, llm: LlmClient) {
  return Layer.mergeAll(
    Layer.succeed(TasksApi, tasksApi),
    Layer.succeed(Llm, llm),
  );
}

export class TasksApi extends Context.Service<TasksApi, TasksApiClient>()(
  "@hackmidwest/agent-api/TasksApi",
) {}

export class Llm extends Context.Service<Llm, LlmClient>()(
  "@hackmidwest/agent-api/Llm",
) {}

export const HTTP_OK = 200;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

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

export function createAgentApiRuntime(
  tasksApi: TasksApiClient,
  llm: LlmClient,
): AgentApiRuntime {
  const runtime = ManagedRuntime.make(agentApiLayer(tasksApi, llm));
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
