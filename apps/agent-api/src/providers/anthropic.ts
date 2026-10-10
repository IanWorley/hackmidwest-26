import type Anthropic from "@anthropic-ai/sdk";
import type { AgentProvider } from "./provider";

const MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = 64_000;
const EFFORT = "medium";
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REFUSAL_STOP_REASON =
  "refusal" satisfies Anthropic.Beta.Messages.BetaStopReason;

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
          yield event.delta.text;
        }
      }
      const { stop_reason: stopReason } = await stream.finalMessage();
      return {
        status: stopReason === REFUSAL_STOP_REASON ? "refused" : "completed",
        stopReason,
      };
    },
  };
}
