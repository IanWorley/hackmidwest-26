import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "./client";

export const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../drizzle/", import.meta.url),
);

/** Drizzle's journal makes completed migrations a no-op on a second run. */
export function applyMigrations(db: Database): Promise<void> {
  return migrate(db, { migrationsFolder: MIGRATIONS_DIRECTORY });
}
