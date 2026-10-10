import Anthropic from "@anthropic-ai/sdk";
import { openDatabase } from "@hackmidwest/db";
import { createApp } from "./app";
import { readAgentApiConfig } from "./config";
import { failInterruptedRuns } from "./features/agent-runs";
import { createAnthropicProvider } from "./providers/anthropic";

const config = readAgentApiConfig(process.env);
const store = openDatabase(config.database);
const app = createApp({
  db: store.db,
  providers: { anthropic: createAnthropicProvider(new Anthropic()) },
});
const EXIT_FAILURE = 1;
// Runs spend Anthropic credits and have no auth yet, so only this machine may reach the API.
const LISTEN_HOSTNAME = "localhost";
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[];
let shutdown: Promise<void> | undefined;

// Both signals converge on the same shutdown operation.
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
  await failInterruptedRuns(store.db);
  app.listen({ port: config.port, hostname: LISTEN_HOSTNAME });
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
