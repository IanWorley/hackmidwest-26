import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

// Node workers use libSQL, so these tests never depend on bun:sqlite.
export default defineProject({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "agent-api",
    environment: "node",
    pool: "forks",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
