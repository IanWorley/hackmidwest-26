import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { TasksApiClient } from "./tasks-api";

type InternalServerFailure = ElysiaCustomStatusResponse<
  typeof HTTP_INTERNAL_SERVER_ERROR,
  typeof internalServerErrorResponse.static
>;

function agentApiLayer(tasksApi: TasksApiClient) {
  return Layer.succeed(TasksApi, tasksApi);
}

export class TasksApi extends Context.Service<TasksApi, TasksApiClient>()(
  "@hackmidwest/agent-api/TasksApi",
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
): AgentApiRuntime {
  const runtime = ManagedRuntime.make(agentApiLayer(tasksApi));
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
