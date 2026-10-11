import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Effect } from "effect";
import { type LlmClient, LlmError, type NarrationPrompt } from "./llm";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
/** OpenRouter lists the app in its dashboard under these two headers. */
const APP_REFERER = "https://github.com/IanWorley/hackmidwest-26";
const APP_TITLE = "Closure Call";

const ChatCompletionSchema = Type.Object({
  choices: Type.Array(
    Type.Object({
      message: Type.Object({ content: Type.String({ minLength: 1 }) }),
    }),
  ),
});

interface OpenRouterSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

function messageContent(body: unknown): string | undefined {
  if (!Value.Check(ChatCompletionSchema, body)) {
    return undefined;
  }
  return body.choices[0]?.message.content;
}

function createOpenRouterLlm({
  baseUrl,
  apiKey,
  model,
}: OpenRouterSettings): LlmClient {
  const narrate = Effect.fn("OpenRouter.narrate")(function* (
    prompt: NarrationPrompt,
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${baseUrl}${CHAT_COMPLETIONS_PATH}`, {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "http-referer": APP_REFERER,
            "x-title": APP_TITLE,
          },
          body: JSON.stringify({ model, messages: prompt.messages }),
        }),
      catch: (cause) => new LlmError({ cause }),
    });
    if (!response.ok) {
      return yield* Effect.fail(
        new LlmError({ cause: `OpenRouter answered ${response.status}` }),
      );
    }
    const body: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new LlmError({ cause }),
    });
    const content = messageContent(body);
    if (content === undefined) {
      return yield* Effect.fail(
        new LlmError({ cause: "OpenRouter reply has no message content" }),
      );
    }
    return content;
  });
  return { narrate };
}

export { createOpenRouterLlm, OPENROUTER_BASE_URL };
