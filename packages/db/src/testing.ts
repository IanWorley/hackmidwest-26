import {
  type DatabaseLocation,
  type DatabaseStore,
  openDatabase,
} from "./client";
import { applyMigrations } from "./migrations";
import { seedDemoFacilities } from "./seed";

const MEMORY: DatabaseLocation = { kind: "memory" };

/** A fresh connection plus real migrations is the fixture; no SQL copy lives in tests. Pass a file location when a test needs more than one connection. */
export async function createTestDatabase(
  location: DatabaseLocation = MEMORY,
): Promise<DatabaseStore> {
  const store = openDatabase(location);
  try {
    await applyMigrations(store.db);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}

/** The test database holding the same demo facilities `db:seed` writes. */
export async function createTestDatabaseWithDemoFacilities(
  location: DatabaseLocation = MEMORY,
): Promise<DatabaseStore> {
  const store = await createTestDatabase(location);
  try {
    await seedDemoFacilities(store.db);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
}

export { DEMO_ROSTER_CASES } from "./demo-rosters";
