import { type Database, TASK_TITLE_LENGTH, tasks } from "@hackmidwest/db";
import { asc } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Elysia, t } from "elysia";

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

/** The feature owns endpoint behavior; database rows and validators come from one table. */
export function createTasksModule(db: Database) {
  return new Elysia({ name: "tasks" })
    .get(
      TASKS_PATH,
      async () => db.select().from(tasks).orderBy(asc(tasks.id)),
      {
        response: t.Array(taskResponse),
      },
    )
    .post(
      TASKS_PATH,
      async ({ body, status }) => {
        const [task] = await db.insert(tasks).values(body).returning();
        if (task === undefined) {
          throw new Error("Task insert did not return its row");
        }
        return status(HTTP_CREATED, task);
      },
      {
        body: createTaskBody,
        response: { [HTTP_CREATED]: taskResponse },
      },
    );
}
