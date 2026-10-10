import type { Database } from "@hackmidwest/db";
import { Elysia } from "elysia";
import { createAgentRunsModule } from "./features/agent-runs";
import type { ProviderRegistry } from "./providers/provider";

type AppDependencies = {
  readonly db: Database;
  readonly providers: ProviderRegistry;
};

export function createApp({ db, providers }: AppDependencies) {
  return new Elysia().use(createAgentRunsModule(db, providers));
}

export type App = ReturnType<typeof createApp>;
