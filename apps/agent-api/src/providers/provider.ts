import type { AgentRunStatus } from "@hackmidwest/db";

export type AgentRunRequest = {
  readonly prompt: string;
};

/** How a provider's run ended. Failures throw instead. */
export type AgentRunEnd = {
  readonly status: Extract<AgentRunStatus, "completed" | "refused">;
  readonly stopReason: string | null;
};

/** Yields output text as it arrives and returns how the run ended. */
export interface AgentProvider {
  run(
    request: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<string, AgentRunEnd>;
}

/** Adding a provider means adding its id here; the compiler then demands an implementation. */
export const PROVIDER_IDS = ["anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderRegistry = Readonly<Record<ProviderId, AgentProvider>>;
