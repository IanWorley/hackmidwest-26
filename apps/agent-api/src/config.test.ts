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

it("reads a blank OPENROUTER_API_KEY as unset", () => {
  const environment = Object.fromEntries([
    ["AGENT_API_PORT", "3002"],
    ["TASKS_API_URL", "http://localhost:3001"],
    ["OPENROUTER_API_KEY", ""],
    ["OPENROUTER_MODEL", "openai/gpt-4o-mini"],
  ]);

  expect(readAgentApiConfig(environment).llm).toEqual({ kind: "template" });
});

it("reads OPENROUTER_API_KEY and OPENROUTER_MODEL as the OpenRouter provider", () => {
  const environment = Object.fromEntries([
    ["AGENT_API_PORT", "3002"],
    ["TASKS_API_URL", "http://localhost:3001"],
    ["OPENROUTER_API_KEY", "sk-or-test"],
    ["OPENROUTER_MODEL", "openai/gpt-4o-mini"],
  ]);

  expect(readAgentApiConfig(environment).llm).toEqual({
    kind: "openrouter",
    apiKey: "sk-or-test",
    model: "openai/gpt-4o-mini",
  });
});

it("refuses an OPENROUTER_API_KEY without an OPENROUTER_MODEL", () => {
  const environment = Object.fromEntries([
    ["AGENT_API_PORT", "3002"],
    ["TASKS_API_URL", "http://localhost:3001"],
    ["OPENROUTER_API_KEY", "sk-or-test"],
  ]);

  expect(() => readAgentApiConfig(environment)).toThrow(
    "OPENROUTER_MODEL must be configured with OPENROUTER_API_KEY",
  );
});
