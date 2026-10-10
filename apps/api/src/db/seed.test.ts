import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../test/database";
import { tasks } from "./schema";
import { DEMO_TASK_ID, seedDemoTasks } from "./seed";

const EDITED_TITLE = "Renamed by a collaborator";

it("preserves an edited demo task when the seed runs again", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoTasks(store.db);
    await store.db
      .update(tasks)
      .set({ title: EDITED_TITLE })
      .where(eq(tasks.id, DEMO_TASK_ID));

    await seedDemoTasks(store.db);

    expect(await store.db.select().from(tasks)).toEqual([
      { id: DEMO_TASK_ID, title: EDITED_TITLE, completed: false },
    ]);
  } finally {
    store.close();
  }
});
