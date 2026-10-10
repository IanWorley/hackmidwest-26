import { openDatabase } from "../src/client";
import { readDatabaseLocation } from "../src/location";
import { seedDemoTasks } from "../src/seed";

const store = openDatabase(readDatabaseLocation(process.env));
try {
  await seedDemoTasks(store.db);
} finally {
  store.close();
}
