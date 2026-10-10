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

const WORKSPACES = "^(apps|packages)/";
const WEB_SRC = "^apps/web/src/";
const API_WORKSPACE = "^apps/api/";
const API_SRC = "^apps/api/src/";
const API_CONFIG = "^apps/api/src/config\\.ts$";
const DB_WORKSPACE = "^packages/db/";
const DB_CLIENT = "^packages/db/src/client\\.ts$";
const DB_TEST_FIXTURE = "^packages/db/src/testing\\.ts$";
const LIBSQL_DRIVER = inPackage("@libsql/[^/]+");
// The bare "bun" module resolves to its type package.
const BUN_MODULES = ["^bun(:|$)", inPackage("@types/bun")];
const NODE_COMPATIBLE_SOURCE = "^(apps/api|packages/db)/src/";
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
  API_WORKSPACE,
  DB_WORKSPACE,
  inPackage("@hackmidwest/(api|db)"),
  inPackage("drizzle-orm"),
  inPackage("drizzle-typebox"),
  inPackage("drizzle-kit"),
  LIBSQL_DRIVER,
  inPackage("elysia"),
  ...BUN_MODULES,
];

const HTTP_FRAMEWORKS = [inPackage("elysia"), inPackage("@elysiajs/[^/]+")];

const API_ENTRY_POINT = "^apps/api/src/index\\.ts$";
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
        "API and database source also runs on Node under Vitest. Only the Bun entry point, apps/api/src/index.ts, " +
        "may load Bun modules.",
      severity: "error",
      from: { path: NODE_COMPATIBLE_SOURCE, pathNot: API_ENTRY_POINT },
      to: { path: BUN_MODULES },
    },
    {
      name: "api-only-entry-points-open-resources",
      comment:
        "Only src/index.ts (and tests) read config or open a database connection, directly or through another " +
        "module. App and feature code receive config and `db` as parameters.",
      severity: "error",
      from: { path: API_SRC, pathNot: [API_ENTRY_POINT, TEST_FILE] },
      to: { path: [API_CONFIG, DB_CLIENT], reachable: true },
    },
    {
      name: "api-db-fixture-only-in-tests",
      comment:
        "Only *.test.ts files use @hackmidwest/db/testing, directly or through another module. Production " +
        "code, including src/index.ts, opens the database with openDatabase() from @hackmidwest/db/connection.",
      severity: "error",
      from: { path: API_SRC, pathNot: TEST_FILE },
      to: { path: DB_TEST_FIXTURE, reachable: true },
    },
  ],
  options: {
    tsPreCompilationDeps: false,
    doNotFollow: { path: ["node_modules", BUILD_OUTPUT] },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
    },
  },
} satisfies IConfiguration;
