import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db/vitest.config.ts",
      "apps/api/vitest.config.ts",
      "apps/web/vitest.config.ts",
      {
        test: {
          name: "repo",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
