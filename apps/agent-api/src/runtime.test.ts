import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  createAgentApiRuntime,
  HTTP_INTERNAL_SERVER_ERROR,
  INTERNAL_ERROR_MESSAGE,
} from "./runtime";
import { createTasksApiClient } from "./tasks-api";

const UNUSED_TASKS_API_ORIGIN = "http://tasks-api.test";

it("turns a failed program into a generic 500 without its details", async () => {
  const runtime = createAgentApiRuntime(
    createTasksApiClient(UNUSED_TASKS_API_ORIGIN),
  );
  try {
    const result = await runtime.runRequest(
      Effect.fail(new Error("upstream provider detail")),
    );

    expect(result).toMatchObject({
      code: HTTP_INTERNAL_SERVER_ERROR,
      response: { message: INTERNAL_ERROR_MESSAGE },
    });
  } finally {
    await runtime.dispose();
  }
});
