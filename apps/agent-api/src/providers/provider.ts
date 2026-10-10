/** What every provider streams back, independent of its vendor SDK. */
export type AgentEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "done"; readonly stopReason: string };

export type AgentRunRequest = {
  readonly prompt: string;
};

/** Implementations throw on failure; the caller owns persistence and error reporting. */
export interface AgentProvider {
  run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

/** Adding a provider means adding its id here; the compiler then demands an implementation. */
export const PROVIDER_IDS = ["anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderRegistry = Readonly<Record<ProviderId, AgentProvider>>;
