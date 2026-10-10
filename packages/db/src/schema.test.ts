import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { tasks } from "./schema";
import { createTestDatabase } from "./testing";

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

it("rejects an unknown agent run status even from a raw SQL writer", async () => {
  const store = await createTestDatabase();
  try {
    await expect(
      store.db.run(
        sql`insert into agent_runs (provider, prompt, status) values ('anthropic', 'Plan the demo', 'done')`,
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: agent_runs_status",
        ),
      },
    });
  } finally {
    store.close();
  }
});
