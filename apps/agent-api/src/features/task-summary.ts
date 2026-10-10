import { Data, Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
  TasksApi,
} from "../runtime";

export const TASK_SUMMARY_PATH = "/tasks/summary";

const count = t.Integer({ minimum: 0 });
const taskSummaryResponse = t.Object({
  total: count,
  completed: count,
  open: count,
});

class TasksApiError extends Data.TaggedError("TasksApiError")<{
  readonly cause: unknown;
}> {}

const summarizeTasks = Effect.fn("summarizeTasks")(function* () {
  const tasksApi = yield* TasksApi;
  const result = yield* Effect.tryPromise({
    try: (signal) => tasksApi.api.tasks.get({ fetch: { signal } }),
    catch: (cause) => new TasksApiError({ cause }),
  });
  if (result.error !== null) {
    return yield* Effect.fail(new TasksApiError({ cause: result.error.value }));
  }
  const completed = result.data.filter((task) => task.completed).length;
  return {
    total: result.data.length,
    completed,
    open: result.data.length - completed,
  };
});

export function createTaskSummaryModule(runRequest: RunRequest) {
  return new Elysia({ name: "task-summary" }).get(
    TASK_SUMMARY_PATH,
    () => runRequest(summarizeTasks()),
    {
      response: {
        [HTTP_OK]: taskSummaryResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}
