import { expect, it } from "vitest";
import { readApiConfig } from "./config";

it("names NWS_USER_AGENT when it is missing", () => {
  const environment = Object.fromEntries([
    ["API_PORT", "3001"],
    ["WEB_ORIGIN", "http://localhost:3000"],
    ["DB_PATH", ".data/test.sqlite"],
  ]);

  expect(() => readApiConfig(environment)).toThrow(
    "NWS_USER_AGENT must be configured; NWS requires an app name and contact",
  );
});

it("reads a blank AIRNOW_API_KEY as unset", () => {
  const environment = Object.fromEntries([
    ["API_PORT", "3001"],
    ["WEB_ORIGIN", "http://localhost:3000"],
    ["DB_PATH", ".data/test.sqlite"],
    ["NWS_USER_AGENT", "(closure-call, test@example.com)"],
    ["AIRNOW_API_KEY", ""],
  ]);

  expect(readApiConfig(environment)).toMatchObject({
    nwsUserAgent: "(closure-call, test@example.com)",
    airNowApiKey: undefined,
  });
});
