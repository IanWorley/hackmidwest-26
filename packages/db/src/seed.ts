import type { Database } from "./client";
import { tasks } from "./schema";

const DEMO_TASK_ID = 1;
const DEMO_TASK_TITLE = "Build the Hack Midwest demo";

/** A reserved fixture key makes repeat runs preserve collaborators' edits. */
export async function seedDemoTasks(db: Database): Promise<void> {
  await db
    .insert(tasks)
    .values({ id: DEMO_TASK_ID, title: DEMO_TASK_TITLE })
    .onConflictDoNothing({ target: tasks.id });
}

export { DEMO_TASK_ID };
