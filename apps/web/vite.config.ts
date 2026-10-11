import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import { reactPlugins } from "./react-plugins";
import { readWebConfig } from "./src/config";
import routeGeneration from "./tsr.config.json" with { type: "json" };

const ROOT_ENV_DIRECTORY = fileURLToPath(new URL("../../", import.meta.url));
const ROUTES_DIRECTORY = fileURLToPath(
  new URL(routeGeneration.routesDirectory, import.meta.url),
);
const GENERATED_ROUTE_TREE = fileURLToPath(
  new URL(routeGeneration.generatedRouteTree, import.meta.url),
);

function requireEnv(environment: Record<string, string>, key: string): string {
  const value = environment[key];
  if (value === undefined || value === "") {
    throw new Error(`${key} must be configured`);
  }
  return value;
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ROOT_ENV_DIRECTORY, "");
  readWebConfig(environment);
  // WEB_ORIGIN is also the API's CORS origin, so the dev port has one source.
  const webPort = Number(new URL(requireEnv(environment, "WEB_ORIGIN")).port);
  return {
    envDir: ROOT_ENV_DIRECTORY,
    resolve: { tsconfigPaths: true },
    server: { port: webPort, strictPort: true },
    plugins: [
      tailwindcss(),
      tanstackStart({
        router: {
          routesDirectory: ROUTES_DIRECTORY,
          generatedRouteTree: GENERATED_ROUTE_TREE,
        },
      }),
      ...reactPlugins(),
    ],
  };
});
