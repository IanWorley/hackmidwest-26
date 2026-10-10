import { createTestDatabase } from "@hackmidwest/db/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { HTTP_CREATED, TASKS_PATH } from "./tasks";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const HTTP_UNPROCESSABLE = 422;

async function withApp(
  run: (app: ReturnType<typeof createApp>) => Promise<void>,
): Promise<void> {
  const store = await createTestDatabase();
  try {
    await run(createApp({ db: store.db, webOrigin: WEB_ORIGIN }));
  } finally {
    store.close();
  }
}

function postTask(body: unknown): Request {
  return new Request(new URL(TASKS_PATH, REQUEST_ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listTasks(): Request {
  return new Request(new URL(TASKS_PATH, REQUEST_ORIGIN));
}

describe(`POST ${TASKS_PATH}`, () => {
  it("creates a task with a database-generated key and default completion state", () =>
    withApp(async (app) => {
      const response = await app.handle(postTask({ title: "Build the demo" }));

      expect(response.status).toBe(HTTP_CREATED);
      expect(await response.json()).toEqual({
        id: 1,
        title: "Build the demo",
        completed: false,
      });
    }));

  it("rejects an empty title without storing a row", () =>
    withApp(async (app) => {
      const response = await app.handle(postTask({ title: "" }));

      expect(response.status).toBe(HTTP_UNPROCESSABLE);
      const list = await app.handle(listTasks());
      expect(await list.json()).toEqual([]);
    }));
});
