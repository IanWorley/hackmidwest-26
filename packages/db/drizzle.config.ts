import { defineConfig } from "drizzle-kit";

const SCHEMA_PATH = "./src/schema.ts";
const MIGRATIONS_PATH = "./drizzle";

// Generation reads schema, not the development database or its credentials.
export default defineConfig({
  dialect: "sqlite",
  schema: SCHEMA_PATH,
  out: MIGRATIONS_PATH,
});
