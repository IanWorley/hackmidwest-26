import { readApiConfig } from "../src/config";
import { openDatabase } from "../src/db/client";
import { seedDemoTasks } from "../src/db/seed";

const store = openDatabase(readApiConfig(process.env).database);
try {
  await seedDemoTasks(store.db);
} finally {
  store.close();
}
