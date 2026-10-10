import { openDatabase } from "./client";
import { applyMigrations } from "./migrations";

/** A fresh connection plus real migrations is the fixture; no SQL copy lives in tests. */
export async function createTestDatabase() {
  const store = openDatabase({ kind: "memory" });
  try {
    await applyMigrations(store.db);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}
