import { Elysia } from "elysia";
import { createHealthModule } from "./features/health";
import { createTaskSummaryModule } from "./features/task-summary";
import type { RunRequest } from "./runtime";

interface AppDependencies {
  readonly runRequest: RunRequest;
}

export function createApp({ runRequest }: AppDependencies) {
  return new Elysia()
    .use(createHealthModule(runRequest))
    .use(createTaskSummaryModule(runRequest));
}
