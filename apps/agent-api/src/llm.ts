import { Data, Effect } from "effect";

interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

/** The template travels beside the chat messages so a layer without a model can return it without parsing text. */
interface NarrationPrompt {
  readonly template: string;
  readonly messages: readonly ChatMessage[];
}

class LlmError extends Data.TaggedError("LlmError")<{
  readonly cause: unknown;
}> {}

interface LlmClient {
  readonly narrate: (
    prompt: NarrationPrompt,
  ) => Effect.Effect<string, LlmError>;
}

const templateLlm: LlmClient = {
  narrate: (prompt) => Effect.succeed(prompt.template),
};

export type { ChatMessage, LlmClient, NarrationPrompt };
export { LlmError, templateLlm };
