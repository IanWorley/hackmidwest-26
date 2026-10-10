import { expect, it } from "vitest";
import { readAgentApiConfig } from "./config";

it("names TASKS_API_URL when its value is not a URL", () => {
  const environment = Object.fromEntries([
    ["AGENT_API_PORT", "3002"],
    ["TASKS_API_URL", "not a url"],
  ]);

  expect(() => readAgentApiConfig(environment)).toThrow(
    "TASKS_API_URL must be an HTTP(S) origin without credentials or a path",
  );
});
