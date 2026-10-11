import { type DatabaseStore, openDatabase } from "./client";
import { applyMigrations } from "./migrations";
import { seedDemoFacilities } from "./seed";

/** A fresh connection plus real migrations is the fixture; no SQL copy lives in tests. */
export async function createTestDatabase(): Promise<DatabaseStore> {
  const store = openDatabase({ kind: "memory" });
  try {
    await applyMigrations(store.db);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}

/** The test database holding the same demo facilities `db:seed` writes. */
export async function createTestDatabaseWithDemoFacilities(): Promise<DatabaseStore> {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}

export { DEMO_ROSTER_CASES } from "./demo-rosters";
