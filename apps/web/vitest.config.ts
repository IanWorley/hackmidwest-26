import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import { reactPlugins } from "./react-plugins";

// Unit tests do not load Start's route compiler or need an API process.
export default defineProject({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: reactPlugins(),
  resolve: { tsconfigPaths: true },
  test: {
    name: "web",
    environment: "jsdom",
    pool: "forks",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
