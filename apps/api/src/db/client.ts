import { createClient } from "@libsql/client/sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const IN_MEMORY_SQLITE_URL = "file::memory:";

export type DatabaseLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "memory" };

/** The caller owns one connection and must close it. Memory connections never share state. */
export function openDatabase(location: DatabaseLocation) {
  const url =
    location.kind === "memory"
      ? IN_MEMORY_SQLITE_URL
      : pathToFileURL(location.path).href;
  if (location.kind === "file") {
    mkdirSync(dirname(location.path), { recursive: true });
  }
  const client = createClient({ url });
  return {
    db: drizzle(client, { schema }),
    close: () => client.close(),
  };
}

export type Database = ReturnType<typeof openDatabase>["db"];
