import type { AgentRunStatus } from "@hackmidwest/db";

export type AgentRunRequest = {
  readonly prompt: string;
};

export type AgentRunEnd = {
  readonly status: Extract<AgentRunStatus, "completed" | "refused">;
  readonly stopReason: string | null;
};

export interface AgentProvider {
  run(
    request: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<string, AgentRunEnd>;
}

export const PROVIDER_IDS = ["anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderRegistry = Readonly<Record<ProviderId, AgentProvider>>;
