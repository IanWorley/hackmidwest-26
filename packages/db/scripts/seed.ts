import process from "node:process";
import { openDatabase } from "../src/client";
import { readDatabaseLocation } from "../src/location";
import { seedDemoFacilities, seedDemoTasks } from "../src/seed";

const store = openDatabase(readDatabaseLocation(process.env));
try {
  await seedDemoTasks(store.db);
  await seedDemoFacilities(store.db);
} finally {
  store.close();
}
