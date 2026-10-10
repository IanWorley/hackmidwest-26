import Anthropic from "@anthropic-ai/sdk";
import { openDatabase } from "@hackmidwest/db";
import { createApp } from "./app";
import { readAgentApiConfig } from "./config";
import { failOrphanedRuns } from "./features/agent-runs";
import { createAnthropicProvider } from "./providers/anthropic";

const config = readAgentApiConfig(process.env);
const store = openDatabase(config.database);
const app = createApp({
  db: store.db,
  providers: { anthropic: createAnthropicProvider(new Anthropic()) },
});
const EXIT_FAILURE = 1;
const LOOPBACK_ONLY_HOSTNAME = "localhost";
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[];
let shutdown: Promise<void> | undefined;

function stop() {
  shutdown ??= (async () => {
    try {
      await app.stop();
    } finally {
      store.close();
    }
  })();
  return shutdown;
}

try {
  await failOrphanedRuns(store.db);
  app.listen({ port: config.port, hostname: LOOPBACK_ONLY_HOSTNAME });
} catch (error) {
  store.close();
  throw error;
}
for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    void stop().catch(() => {
      process.exitCode = EXIT_FAILURE;
    });
  });
}
