import { treaty } from "@elysiajs/eden";
import type { App } from "@hackmidwest/api/contract";

export function createTasksApiClient(baseUrl: string) {
  return treaty<App>(baseUrl);
}

export type TasksApiClient = ReturnType<typeof createTasksApiClient>;
