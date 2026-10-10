import type { IConfiguration } from "dependency-cruiser";

// The graph contains only imports that survive compilation (`tsPreCompilationDeps: false`):
// `import type` and type-only re-exports are erased, exactly as at runtime.

/**
 * Matches a package whether it resolved (Bun installs it at node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/)
 * or not (an undeclared package keeps its bare specifier, e.g. "drizzle-orm/libsql"). Matching both means a
 * rule can't pass just because the import failed to resolve.
 */
const inPackage = (name: string): string => `(^|node_modules/)${name}(/|$)`;

const WEB_SRC = "^apps/web/src/";
const API_WORKSPACE = "^apps/api/";
const API_SRC = "^apps/api/src/";
const API_DB_CLIENT = "^apps/api/src/db/client\\.ts$";
const API_CONFIG = "^apps/api/src/config\\.ts$";
const LIBSQL_DRIVER = inPackage("@libsql/[^/]+");
const BUN_BUILTINS = "^bun:";
const BUILD_OUTPUT = "^apps/[^/]+/dist/";

// Drizzle's adapters create their own client from a URL.
const DATABASE_DRIVERS = [
  LIBSQL_DRIVER,
  inPackage("drizzle-orm/(libsql|bun-sqlite)"),
  `${BUN_BUILTINS}sqlite$`,
];
const DRIZZLE_MIGRATOR = "(^|node_modules/)drizzle-orm/[^/]+/migrator(\\.js)?$";

const SERVER_ONLY = [
  API_WORKSPACE,
  inPackage("@hackmidwest/api"),
  inPackage("drizzle-orm"),
  inPackage("drizzle-typebox"),
  inPackage("drizzle-kit"),
  LIBSQL_DRIVER,
  inPackage("elysia"),
  BUN_BUILTINS,
];

const API_SRC_ENTRY_POINTS = ["^apps/api/src/index\\.ts$", "\\.test\\.ts$"];

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
      name: "api-driver-only-in-db-client",
      comment:
        "Only apps/api/src/db/client.ts opens database connections. Use openDatabase() instead.",
      severity: "error",
      from: { path: API_WORKSPACE, pathNot: API_DB_CLIENT },
      to: { path: DATABASE_DRIVERS, pathNot: DRIZZLE_MIGRATOR },
    },
    {
      name: "api-only-entry-points-open-resources",
      comment:
        "Only entry points read config or open the database, directly or through another module. App and " +
        "feature code receive `db` by injection; `import type { Database }` is fine.",
      severity: "error",
      from: { path: API_SRC, pathNot: API_SRC_ENTRY_POINTS },
      to: { path: [API_CONFIG, API_DB_CLIENT], reachable: true },
    },
  ],
  options: {
    tsPreCompilationDeps: false,
    exclude: { path: BUILD_OUTPUT },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
    },
  },
} satisfies IConfiguration;
