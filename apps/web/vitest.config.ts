import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

// Unit tests do not load Start's route compiler or need an API process.
export default defineProject({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    pool: "forks",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
