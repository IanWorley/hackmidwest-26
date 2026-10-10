import type Anthropic from "@anthropic-ai/sdk";
import type { AgentProvider } from "./provider";

const MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = 64_000;
const EFFORT = "medium";
// Re-runs a refused request on Anthropic's recommended model inside the same stream.
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const UNKNOWN_STOP_REASON = "unknown";

export function createAnthropicProvider(client: Anthropic): AgentProvider {
  return {
    async *run({ prompt }, signal) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          output_config: { effort: EFFORT },
          betas: [SERVER_SIDE_FALLBACK_BETA],
          fallbacks: "default",
          messages: [{ role: "user", content: prompt }],
        },
        { signal },
      );
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text", text: event.delta.text };
        }
      }
      const message = await stream.finalMessage();
      yield {
        type: "done",
        stopReason: message.stop_reason ?? UNKNOWN_STOP_REASON,
      };
    },
  };
}
