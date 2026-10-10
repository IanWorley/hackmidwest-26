import Anthropic from "@anthropic-ai/sdk";
import { openDatabase } from "@hackmidwest/db";
import { createApp } from "./app";
import { readAgentApiConfig } from "./config";
import { createAnthropicProvider } from "./providers/anthropic";

const config = readAgentApiConfig(process.env);
const store = openDatabase(config.database);
const app = createApp({
  db: store.db,
  providers: { anthropic: createAnthropicProvider(new Anthropic()) },
});
const EXIT_FAILURE = 1;
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
  app.listen(config.port);
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
