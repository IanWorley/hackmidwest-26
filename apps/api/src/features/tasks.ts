import { TASK_TITLE_LENGTH, tasks } from "@hackmidwest/db";
import { asc } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../runtime";

export const TASKS_PATH = "/api/tasks";
export const HTTP_CREATED = 201;

const { createSelectSchema, createInsertSchema } = createSchemaFactory({
  typeboxInstance: t,
});
const taskResponse = createSelectSchema(tasks);
const taskInsert = createInsertSchema(tasks, {
  title: t.String({
    minLength: TASK_TITLE_LENGTH.min,
    maxLength: TASK_TITLE_LENGTH.max,
  }),
});

const createTaskBody = t.Object(
  { title: taskInsert.properties.title },
  { additionalProperties: false },
);

type NewTask = Pick<typeof tasks.$inferInsert, "title">;

class TaskStorageError extends Data.TaggedError("TaskStorageError")<{
  readonly operation: "list" | "create";
  readonly cause: unknown;
}> {}

const listTasks = Effect.fn("listTasks")(function* () {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () => db.select().from(tasks).orderBy(asc(tasks.id)),
    catch: (cause) => new TaskStorageError({ operation: "list", cause }),
  });
});

const createTask = Effect.fn("createTask")(function* (input: NewTask) {
  const db = yield* Database;
  const [task] = yield* Effect.tryPromise({
    try: () => db.insert(tasks).values({ title: input.title }).returning(),
    catch: (cause) => new TaskStorageError({ operation: "create", cause }),
  });
  if (task === undefined) {
    return yield* Effect.die(new Error("Task insert did not return its row"));
  }
  return task;
});

export function createTasksModule(runRequest: RunRequest) {
  return new Elysia({ name: "tasks" })
    .get(TASKS_PATH, () => runRequest(listTasks()), {
      response: {
        [HTTP_OK]: t.Array(taskResponse),
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    })
    .post(
      TASKS_PATH,
      ({ body, status }) =>
        runRequest(
          createTask(body).pipe(
            Effect.map((task) => status(HTTP_CREATED, task)),
          ),
        ),
      {
        body: createTaskBody,
        response: {
          [HTTP_CREATED]: taskResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    );
}
