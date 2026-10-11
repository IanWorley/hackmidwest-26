import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { createDirectivesModule } from "./features/closure/decision-directives";
import { createDecisionsModule } from "./features/closure/decisions";
import { createFacilitiesModule } from "./features/closure/facilities";
import { createRecommendationsModule } from "./features/closure/recommendations";
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
    .use(createDecisionsModule(runRequest))
    .use(createDirectivesModule(runRequest))
    .use(createNwsLiveModule(runRequest));
}

export type App = ReturnType<typeof createApp>;
