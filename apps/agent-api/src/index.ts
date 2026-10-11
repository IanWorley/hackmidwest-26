import process from "node:process";
import { createApp } from "./app";
import { type LlmConfig, readAgentApiConfig } from "./config";
import { type LlmClient, templateLlm } from "./llm";
import {
  createOpenRouterLlm,
  OPENROUTER_BASE_URL,
  OPENROUTER_TIMEOUT,
} from "./openrouter";
import { createAgentApiRuntime } from "./runtime";
import { createTasksApiClient } from "./tasks-api";

function createLlm(llm: LlmConfig): LlmClient {
  switch (llm.kind) {
    case "openrouter":
      return createOpenRouterLlm({
        ...llm,
        baseUrl: OPENROUTER_BASE_URL,
        timeout: OPENROUTER_TIMEOUT,
      });
    case "template":
      return templateLlm;
    default:
      return llm satisfies never;
  }
}

const config = readAgentApiConfig(process.env);
const runtime = createAgentApiRuntime(
  createTasksApiClient(config.tasksApiUrl),
  createLlm(config.llm),
);
const app = createApp({ runRequest: runtime.runRequest });
const EXIT_FAILURE = 1;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[];
let shutdown: Promise<void> | undefined;

function stop(): Promise<void> {
  shutdown ??= (async (): Promise<void> => {
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
    stop().catch(() => {
      process.exitCode = EXIT_FAILURE;
    });
  });
}
