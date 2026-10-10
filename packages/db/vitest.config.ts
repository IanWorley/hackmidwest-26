import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "db",
    environment: "node",
    pool: "forks",
    include: ["src/**/*.test.ts"],
  },
});
