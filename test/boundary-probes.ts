import {
  AGENT_API_CRUISE_PROBES,
  AGENT_API_LINT_PROBES,
} from "./agent-api-boundary-probes";
import {
  type BoundaryProbe,
  DB_CONNECTION_STUB,
  DB_SCHEMA_STUB,
  IMPORT_PROCESS,
} from "./probe-fixtures";

const API_CONFIG_STUB = {
  "apps/api/src/config.ts": "export function readApiConfig() {}\n",
};
const DB_TEST_FIXTURE_STUB = {
  ...DB_CONNECTION_STUB,
  "packages/db/src/testing.ts":
    'import { openDatabase } from "./client";\nexport const createTestDatabase = openDatabase;\n',
};
const IMPORT_DB_TEST_FIXTURE =
  'import { createTestDatabase } from "../../../../packages/db/src/testing";\nexport const probe = createTestDatabase;\n';

const API_APP_STUB = {
  "apps/api/src/app.ts": "export type App = object;\n",
};

export const CRUISE_PROBES: readonly BoundaryProbe[] = [
  {
    behavior: "web cannot load the ORM",
    files: { "apps/web/src/probe.ts": 'import "drizzle-orm";\n' },
    violatedRules: ["web-no-server-code"],
  },
  {
    behavior: "web cannot reach the database driver through a helper module",
    files: {
      "apps/web/src/probe.ts": 'import "./helper";\n',
      "apps/web/src/helper.ts": 'import "@libsql/client";\n',
    },
    violatedRules: ["db-driver-only-in-client", "web-no-server-code"],
  },
  {
    behavior: "web cannot load an Elysia runtime value",
    files: {
      "apps/web/src/probe.ts":
        'import { t } from "elysia";\nexport const probe = t;\n',
    },
    violatedRules: ["web-no-server-code"],
  },
  {
    behavior: "web cannot load an Elysia subpath at runtime",
    files: { "apps/web/src/probe.ts": 'import "elysia/adapter/bun";\n' },
    violatedRules: ["web-no-server-code"],
  },
  {
    behavior: "database code cannot load an HTTP framework",
    files: { "packages/db/src/probe.ts": 'import "@elysiajs/cors";\n' },
    violatedRules: ["db-no-http"],
  },
  {
    behavior: "web may import the API contract type",
    files: {
      "apps/web/src/probe.ts":
        'import type { App } from "@hackmidwest/api/contract";\nexport type Probe = App;\n',
    },
    violatedRules: [],
  },
  {
    behavior: "API code cannot import the database driver",
    files: {
      "apps/api/src/features/probe.ts":
        'import { createClient } from "@libsql/client";\nexport const probe = createClient;\n',
    },
    violatedRules: ["db-driver-only-in-client"],
  },
  {
    behavior:
      "API code cannot open a connection through Drizzle's libSQL adapter",
    files: {
      "apps/api/src/features/probe.ts":
        'import { drizzle } from "drizzle-orm/libsql";\nexport const probe = drizzle;\n',
    },
    violatedRules: ["db-driver-only-in-client"],
  },
  {
    behavior: "database code cannot open a connection with node:sqlite",
    files: {
      "packages/db/src/probe.ts":
        'import { DatabaseSync } from "node:sqlite";\nexport const probe = DatabaseSync;\n',
    },
    violatedRules: ["db-driver-only-in-client"],
  },
  {
    behavior: "API code cannot load Bun modules",
    files: {
      "apps/api/src/features/probe.ts":
        'import { file } from "bun";\nexport const probe = file;\n',
    },
    violatedRules: ["node-compatible-source"],
  },
  {
    behavior: "API feature code cannot read config",
    files: {
      ...API_CONFIG_STUB,
      "apps/api/src/features/probe.ts":
        'import { readApiConfig } from "../config";\nexport const probe = readApiConfig;\n',
    },
    violatedRules: ["api-only-entry-points-open-resources"],
  },
  {
    behavior: "API feature code cannot open a database connection",
    files: {
      ...DB_CONNECTION_STUB,
      "apps/api/src/features/probe.ts":
        'import { openDatabase } from "../../../../packages/db/src/client";\nexport const probe = openDatabase;\n',
    },
    violatedRules: ["api-only-entry-points-open-resources"],
  },
  {
    behavior: "API feature code may import tables and the Database type",
    files: {
      ...DB_CONNECTION_STUB,
      "packages/db/src/index.ts":
        'export type { Database } from "./client";\nexport const tasks = {};\n',
      "apps/api/src/features/probe.ts":
        'import { tasks } from "../../../../packages/db/src/index";\nexport const probe = tasks;\n',
    },
    violatedRules: [],
  },
  {
    behavior:
      "API feature code cannot reach the database test fixture through a helper",
    files: {
      ...DB_TEST_FIXTURE_STUB,
      "apps/api/src/features/helper.ts": IMPORT_DB_TEST_FIXTURE,
      "apps/api/src/features/probe.ts": 'import "./helper";\n',
    },
    violatedRules: [
      "api-db-fixture-only-in-tests",
      "api-only-entry-points-open-resources",
    ],
  },
  {
    behavior: "the API entry point cannot use the database test fixture",
    files: {
      ...DB_TEST_FIXTURE_STUB,
      "apps/api/src/index.ts":
        'import { createTestDatabase } from "../../../packages/db/src/testing";\nexport const probe = createTestDatabase;\n',
    },
    violatedRules: ["api-db-fixture-only-in-tests"],
  },
  {
    behavior: "API tests may use the database test fixture",
    files: {
      ...DB_TEST_FIXTURE_STUB,
      "apps/api/src/features/probe.test.ts": IMPORT_DB_TEST_FIXTURE,
    },
    violatedRules: [],
  },
  {
    behavior: "web cannot load the API build output",
    files: {
      "apps/api/dist/index.js": 'import "@libsql/client";\n',
      "apps/web/src/probe.ts": 'import "../../api/dist/index.js";\n',
    },
    violatedRules: ["apps-are-independent", "web-no-server-code"],
  },
  {
    behavior: "build output is not checked",
    files: { "apps/api/dist/index.js": 'import "@libsql/client";\n' },
    violatedRules: [],
  },
  ...AGENT_API_CRUISE_PROBES,
];

/** Each lint probe lists Biome rule names such as "style/noProcessEnv". */
export const LINT_PROBES: readonly BoundaryProbe[] = [
  {
    behavior: "web cannot import database types",
    files: {
      "apps/web/src/probe.ts":
        'import type { Database } from "@hackmidwest/db";\nexport type Probe = Database;\n',
    },
    violatedRules: [
      "correctness/noUndeclaredDependencies",
      "correctness/noUnresolvedImports",
    ],
  },
  {
    behavior: "web cannot import database source by relative path",
    files: {
      ...DB_SCHEMA_STUB,
      "apps/web/src/probe.ts":
        'import type { tasks } from "../../../packages/db/src/schema";\nexport type Probe = typeof tasks;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "API code cannot import database source by relative path",
    files: {
      ...DB_SCHEMA_STUB,
      "apps/api/src/features/probe.ts":
        'import { tasks } from "../../../../packages/db/src/schema";\nexport const probe = tasks;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "API feature code cannot read process.env",
    files: {
      "apps/api/src/features/probe.ts": `${IMPORT_PROCESS}export const probe = process.env.DB_PATH;\n`,
    },
    violatedRules: ["style/noProcessEnv"],
  },
  {
    behavior: "database code cannot use the Bun global",
    files: {
      "packages/db/src/probe.ts": "export const probe = Bun.env.DB_PATH;\n",
    },
    violatedRules: [
      "correctness/noUndeclaredVariables",
      "style/noRestrictedGlobals",
    ],
  },
  {
    behavior: "the API entry point may read process.env",
    files: {
      "apps/api/src/index.ts": `${IMPORT_PROCESS}export const probe = process.env.API_PORT;\n`,
    },
    violatedRules: [],
  },
  {
    behavior: "database code cannot import API source by relative path",
    files: {
      ...API_APP_STUB,
      "packages/db/src/probe.ts":
        'import type { App } from "../../../apps/api/src/app";\nexport type Probe = App;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior:
      "a workspace without a Biome config cannot import another workspace's source",
    files: {
      ...API_APP_STUB,
      "apps/extra/src/probe.ts":
        'import type { App } from "../../api/src/app";\nexport type Probe = App;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "API production code cannot import a dev dependency",
    files: {
      "apps/api/src/features/probe.ts":
        'import { expect } from "vitest";\nexport const probe = expect;\n',
    },
    violatedRules: ["correctness/noUndeclaredDependencies"],
  },
  {
    behavior: "web cannot call fetch directly",
    files: {
      "apps/web/src/probe.ts":
        'export function probe(): Promise<Response> {\n  return fetch("/api/tasks");\n}\n',
    },
    violatedRules: ["style/noRestrictedGlobals"],
  },
  ...AGENT_API_LINT_PROBES,
];
