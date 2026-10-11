import { fileURLToPath } from "node:url";
import type { IConfiguration } from "dependency-cruiser";

// The graph contains only imports that survive compilation (`tsPreCompilationDeps: false`):
// `import type` and type-only re-exports are erased, exactly as at runtime.

/**
 * Matches a package whether it resolved (Bun installs it at node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/)
 * or not (an undeclared package keeps its bare specifier, e.g. "drizzle-orm/libsql"). Matching both means a
 * rule can't pass just because the import failed to resolve.
 */
function inPackage(name: string): string {
  return `(^|node_modules/)${name}(/|$)`;
}

// Absolute, because TypeScript resolves a relative tsconfig's `extends` against the wrong directory.
const WEB_TSCONFIG = fileURLToPath(
  new URL("apps/web/tsconfig.json", import.meta.url),
);
const WORKSPACES = "^(apps|packages)/";
const WEB_SRC = "^apps/web/src/";
const BACKEND_APP = "apps/(?!web/)[^/]+";
const BACKEND_WORKSPACE = `^${BACKEND_APP}/`;
const BACKEND_SRC = `^${BACKEND_APP}/src/`;
const BACKEND_CONFIG = `^${BACKEND_APP}/src/config\\.ts$`;
const DB_WORKSPACE = "^packages/db/";
const AGENT_API_WORKSPACE = "^apps/agent-api/";
const DB_CLIENT = "^packages/db/src/client\\.ts$";
const DB_TEST_FIXTURE = "^packages/db/src/testing\\.ts$";
const LIBSQL_DRIVER = inPackage("@libsql/[^/]+");
// The bare "bun" module resolves to its type package.
const BUN_MODULES = ["^bun(:|$)", inPackage("@types/bun")];
const NODE_COMPATIBLE_SOURCE = `^(${BACKEND_APP}|packages/db)/src/`;
const BUILD_OUTPUT = "^(apps|packages)/[^/]+/dist/";

// Drizzle's adapters create their own client from a URL.
const DATABASE_DRIVERS = [
  LIBSQL_DRIVER,
  inPackage("drizzle-orm/(libsql|bun-sqlite)"),
  "^bun:sqlite$",
  "^node:sqlite$",
];
const DRIZZLE_MIGRATOR = "(^|node_modules/)drizzle-orm/[^/]+/migrator(\\.js)?$";

const SERVER_ONLY = [
  BACKEND_WORKSPACE,
  DB_WORKSPACE,
  inPackage("@hackmidwest/(?!web(/|$))[^/]+"),
  inPackage("drizzle-orm"),
  inPackage("drizzle-typebox"),
  inPackage("drizzle-kit"),
  LIBSQL_DRIVER,
  inPackage("elysia"),
  ...BUN_MODULES,
];

const HTTP_FRAMEWORKS = [inPackage("elysia"), inPackage("@elysiajs/[^/]+")];

const WORKSPACE_APP_PACKAGE = inPackage("@hackmidwest/(?!db(/|$))[^/]+");
const BACKEND_ENTRY_POINT = `^${BACKEND_APP}/src/index\\.ts$`;
const TEST_FILE = "\\.test\\.ts$";

export default {
  forbidden: [
    {
      name: "web-no-server-code",
      comment:
        "Web code must not load the API, the database, or Elysia at runtime, directly or through any chain " +
        "of imports. Import the App type from @hackmidwest/api/contract and call the API through lib/api.ts.",
      severity: "error",
      from: { path: WEB_SRC },
      to: { path: SERVER_ONLY, reachable: true },
    },
    {
      name: "db-driver-only-in-client",
      comment:
        "Only packages/db/src/client.ts opens database connections. Use openDatabase() from @hackmidwest/db/connection.",
      severity: "error",
      from: { path: WORKSPACES, pathNot: DB_CLIENT },
      to: { path: DATABASE_DRIVERS, pathNot: DRIZZLE_MIGRATOR },
    },
    {
      name: "db-no-http",
      comment:
        "packages/db owns persistence. HTTP belongs in an app, so the package never loads an HTTP framework.",
      severity: "error",
      from: { path: DB_WORKSPACE },
      to: { path: HTTP_FRAMEWORKS },
    },
    {
      name: "node-compatible-source",
      comment:
        "Backend and database source also runs on Node under Vitest. Only a backend's Bun entry point, " +
        "apps/<backend>/src/index.ts, may load Bun modules.",
      severity: "error",
      from: { path: NODE_COMPATIBLE_SOURCE, pathNot: BACKEND_ENTRY_POINT },
      to: { path: BUN_MODULES },
    },
    {
      name: "api-only-entry-points-open-resources",
      comment:
        "In a backend, only src/index.ts (and tests) read config or open a database connection, directly or " +
        "through another module. App and feature code receive config and `db` as parameters.",
      severity: "error",
      from: { path: BACKEND_SRC, pathNot: [BACKEND_ENTRY_POINT, TEST_FILE] },
      to: { path: [BACKEND_CONFIG, DB_CLIENT], reachable: true },
    },
    {
      name: "apps-are-independent",
      comment:
        "Each app is a separate deployable. It must not load another app's code at runtime, directly or through " +
        "any chain of imports. Import only an app's erased contract type, such as App from " +
        "@hackmidwest/api/contract, and call it over HTTP.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: {
        path: ["^apps/", WORKSPACE_APP_PACKAGE],
        pathNot: "^apps/$1/",
        reachable: true,
      },
    },
    {
      name: "agent-api-reads-tasks-over-http",
      comment:
        "The agent API never loads the database, directly or through any chain of imports, so apps/api stays the " +
        "only SQLite writer and owns every task rule. Yield the TasksApi service (apps/agent-api/src/runtime.ts) " +
        "and call apps/api over HTTP.",
      severity: "error",
      from: { path: AGENT_API_WORKSPACE },
      to: {
        path: [DB_WORKSPACE, inPackage("@hackmidwest/db")],
        reachable: true,
      },
    },
    {
      name: "api-db-fixture-only-in-tests",
      comment:
        "Only *.test.ts files use @hackmidwest/db/testing, directly or through another module. Production " +
        "code, including src/index.ts, opens the database with openDatabase() from @hackmidwest/db/connection.",
      severity: "error",
      from: { path: BACKEND_SRC, pathNot: TEST_FILE },
      to: { path: DB_TEST_FIXTURE, reachable: true },
    },
  ],
  options: {
    tsPreCompilationDeps: false,
    // Resolves the web app's `@/` alias, so web rules still see aliased imports.
    tsConfig: { fileName: WEB_TSCONFIG },
    doNotFollow: { path: ["node_modules", BUILD_OUTPUT] },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
    },
  },
} satisfies IConfiguration;
