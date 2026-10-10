import { openDatabase } from "@hackmidwest/db";
import { createApp } from "./app";
import { readApiConfig } from "./config";

const config = readApiConfig(process.env);
const store = openDatabase(config.database);
const app = createApp({ db: store.db, webOrigin: config.webOrigin });
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
