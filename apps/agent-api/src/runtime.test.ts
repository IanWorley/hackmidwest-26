import { Effect } from "effect";
import { expect, it } from "vitest";
import { createApiClients } from "./api-client";
import { templateLlm } from "./llm";
import {
  createAgentApiRuntime,
  HTTP_INTERNAL_SERVER_ERROR,
  INTERNAL_ERROR_MESSAGE,
} from "./runtime";

const UNUSED_API_ORIGIN = "http://api.test";

it("turns a failed program into a generic 500 without its details", async () => {
  const runtime = createAgentApiRuntime({
    ...createApiClients(UNUSED_API_ORIGIN),
    llm: templateLlm,
  });
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
