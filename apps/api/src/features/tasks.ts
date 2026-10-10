import { asc } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { Database } from "../db/client";
import { createTaskBody, taskResponse, tasks } from "../db/schema";

export const TASKS_PATH = "/api/tasks";
export const HTTP_CREATED = 201;

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
