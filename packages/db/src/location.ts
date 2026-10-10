import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseLocation } from "./client";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readDatabaseLocation(
  environment: NodeJS.ProcessEnv,
): DatabaseLocation {
  const path = environment.DB_PATH;
  if (path === undefined || path === "") {
    throw new Error("DB_PATH must be configured");
  }
  return { kind: "file", path: resolve(REPOSITORY_ROOT, path) };
}
