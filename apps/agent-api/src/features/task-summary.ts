import { Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
  TasksApi,
} from "../runtime";

const TASK_SUMMARY_PATH = "/tasks/summary";

const count = t.Integer({ minimum: 0 });
const taskSummaryResponse = t.Object({
  total: count,
  completed: count,
  open: count,
});

const summarizeTasks = Effect.fn("summarizeTasks")(function* () {
  const tasksApi = yield* TasksApi;
  const tasks = yield* tasksApi.listTasks();
  const completed = tasks.filter((task) => task.completed).length;
  return {
    total: tasks.length,
    completed,
    open: tasks.length - completed,
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

export { TASK_SUMMARY_PATH };
