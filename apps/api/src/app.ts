import { cors } from "@elysiajs/cors";
import type { Database } from "@hackmidwest/db";
import { Elysia } from "elysia";
import { createTasksModule } from "./features/tasks";

type AppDependencies = {
  readonly db: Database;
  readonly webOrigin: string;
};

/** Construct an app without opening a database, reading env, or starting a listener. */
export function createApp({ db, webOrigin }: AppDependencies) {
  return new Elysia()
    .use(cors({ origin: webOrigin }))
    .use(createTasksModule(db));
}

export type App = ReturnType<typeof createApp>;
