import { createApp } from "./app";
import { readAgentApiConfig } from "./config";
import { createAgentApiRuntime } from "./runtime";
import { createTasksApiClient } from "./tasks-api";

const config = readAgentApiConfig(process.env);
const runtime = createAgentApiRuntime(createTasksApiClient(config.tasksApiUrl));
const app = createApp({ runRequest: runtime.runRequest });
const EXIT_FAILURE = 1;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[];
let shutdown: Promise<void> | undefined;

function stop() {
  shutdown ??= (async () => {
    try {
      await app.stop();
    } finally {
      await runtime.dispose();
    }
  })();
  return shutdown;
}

try {
  app.listen(config.port);
} catch (error) {
  await runtime.dispose();
  throw error;
}
for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    void stop().catch(() => {
      process.exitCode = EXIT_FAILURE;
    });
  });
}
