import { openDatabase } from "../src/client";
import { readDatabaseLocation } from "../src/location";
import { applyMigrations } from "../src/migrations";

const store = openDatabase(readDatabaseLocation(process.env));
try {
  await applyMigrations(store.db);
} finally {
  store.close();
}
