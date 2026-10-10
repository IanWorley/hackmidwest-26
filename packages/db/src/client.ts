import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const IN_MEMORY_SQLITE_URL = "file::memory:";

function toSqliteUrl(location: DatabaseLocation): string {
  if (location.kind === "memory") {
    return IN_MEMORY_SQLITE_URL;
  }
  return pathToFileURL(location.path).href;
}

export type DatabaseLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "memory" };

/** The caller owns one connection and must close it. Memory connections never share state. */
export function openDatabase(location: DatabaseLocation) {
  if (location.kind === "file") {
    mkdirSync(dirname(location.path), { recursive: true });
  }
  const client = createClient({ url: toSqliteUrl(location) });
  return {
    db: drizzle(client, { schema }),
    close: (): void => client.close(),
  };
}

export type DatabaseStore = ReturnType<typeof openDatabase>;
export type Database = DatabaseStore["db"];
