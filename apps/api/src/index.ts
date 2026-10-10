import { openDatabase } from "@hackmidwest/db";
import { createApp } from "./app";
import { readApiConfig } from "./config";
import { createApiRuntime } from "./runtime";

const config = readApiConfig(process.env);
const store = openDatabase(config.database);
const runtime = createApiRuntime(store.db);
const app = createApp({
  runRequest: runtime.runRequest,
  webOrigin: config.webOrigin,
});
const EXIT_FAILURE = 1;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[];
let shutdown: Promise<void> | undefined;

async function release() {
  try {
    await runtime.dispose();
  } finally {
    store.close();
  }
}

// Both signals converge on the same shutdown operation.
function stop() {
  shutdown ??= (async () => {
    try {
      await app.stop();
    } finally {
      await release();
    }
  })();
  return shutdown;
}

try {
  app.listen(config.port);
} catch (error) {
  await release();
  throw error;
}
for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    void stop().catch(() => {
      process.exitCode = EXIT_FAILURE;
    });
  });
}
