import { expect, it } from "vitest";
import { createTestDatabase } from "../../test/database";
import { tasks } from "./schema";

it("rejects an empty title even when a caller bypasses the HTTP validator", async () => {
  const store = await createTestDatabase();
  try {
    await expect(
      store.db.insert(tasks).values({ title: "" }).execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: tasks_title_length",
        ),
      },
    });
  } finally {
    store.close();
  }
});
