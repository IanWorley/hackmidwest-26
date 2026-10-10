import { readApiConfig } from "../src/config";
import { openDatabase } from "../src/db/client";
import { applyMigrations } from "../src/db/migrations";

const store = openDatabase(readApiConfig(process.env).database);
try {
  await applyMigrations(store.db);
} finally {
  store.close();
}
