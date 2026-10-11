import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { createFacilitiesModule } from "./features/closure/facilities";
import { createNotificationPreviewModule } from "./features/closure/notification-preview";
import { createRecommendationsModule } from "./features/closure/recommendations";
import { createFloodLiveModule } from "./features/flood-live";
import { createNwsLiveModule } from "./features/nws-live";
import { createTasksModule } from "./features/tasks";
import type { RunRequest } from "./runtime";

interface AppDependencies {
  readonly runRequest: RunRequest;
  readonly webOrigin: string;
}

/** Construct an app without opening a database, reading env, or starting a listener. */
export function createApp({ runRequest, webOrigin }: AppDependencies) {
  return new Elysia()
    .use(cors({ origin: webOrigin }))
    .use(createTasksModule(runRequest))
    .use(createFacilitiesModule(runRequest))
    .use(createRecommendationsModule(runRequest))
    .use(createNotificationPreviewModule(runRequest))
    .use(createNwsLiveModule(runRequest))
    .use(createFloodLiveModule(runRequest));
}

export type App = ReturnType<typeof createApp>;
