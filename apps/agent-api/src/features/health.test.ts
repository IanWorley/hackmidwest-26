import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { templateLlm } from "../llm";
import { createAgentApiRuntime, HTTP_OK } from "../runtime";
import { createTasksApiClient } from "../tasks-api";
import { HEALTH_PATH, HEALTHY_STATUS } from "./health";

const REQUEST_ORIGIN = "http://agent-api.test";
const UNUSED_TASKS_API_ORIGIN = "http://tasks-api.test";

describe(`GET ${HEALTH_PATH}`, () => {
  it("reports that the process is serving requests", async () => {
    const runtime = createAgentApiRuntime(
      createTasksApiClient(UNUSED_TASKS_API_ORIGIN),
      templateLlm,
    );
    try {
      const app = createApp({ runRequest: runtime.runRequest });

      const response = await app.handle(
        new Request(new URL(HEALTH_PATH, REQUEST_ORIGIN)),
      );

      expect(response.status).toBe(HTTP_OK);
      expect(await response.json()).toEqual({ status: HEALTHY_STATUS });
    } finally {
      await runtime.dispose();
    }
  });
});
