import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { expect, it } from "vitest";
import config from "../.dependency-cruiser";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIOME_CONFIG = "biome.json";
// Biome's JS launcher, run with the current Node binary so the spawn works on every OS.
const BIOME_LAUNCHER = join(
  REPOSITORY_ROOT,
  "node_modules/@biomejs/biome/bin/biome",
);
const BIOME_EXIT_CLEAN = 0;
const BIOME_EXIT_DIAGNOSTICS = 1;
const BIOME_RULE = /lint\/(\w+\/\w+)/g;
const ROOT_INSTALL_DIRECTORY = "node_modules";
const INSTALL_DIRECTORIES = [
  ROOT_INSTALL_DIRECTORY,
  "apps/api/node_modules",
  "apps/agent-api/node_modules",
  "apps/web/node_modules",
];

type BoundaryProbe = {
  readonly behavior: string;
  readonly files: Readonly<Record<string, string>>;
  readonly violatedRules: readonly string[];
};

const API_CONFIG_STUB = {
  "apps/api/src/config.ts": "export function readApiConfig() {}\n",
};
// Relative imports keep the fixture inside the sandbox; the workspace symlink points at the real repository.
const DB_CONNECTION_STUB = {
  "packages/db/src/client.ts":
    "export type Database = object;\nexport function openDatabase() {}\n",
};
const DB_TEST_FIXTURE_STUB = {
  ...DB_CONNECTION_STUB,
  "packages/db/src/testing.ts":
    'import { openDatabase } from "./client";\nexport const createTestDatabase = openDatabase;\n',
};
const IMPORT_DB_TEST_FIXTURE =
  'import { createTestDatabase } from "../../../../packages/db/src/testing";\nexport const probe = createTestDatabase;\n';

const PROBES: readonly BoundaryProbe[] = [
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
    behavior: "agent API code cannot load Bun modules",
    files: {
      "apps/agent-api/src/features/probe.ts":
        'import { file } from "bun";\nexport const probe = file;\n',
    },
    violatedRules: ["node-compatible-source"],
  },
  {
    behavior: "agent API feature code cannot read config",
    files: {
      "apps/agent-api/src/config.ts":
        "export function readAgentApiConfig() {}\n",
      "apps/agent-api/src/features/probe.ts":
        'import { readAgentApiConfig } from "../config";\nexport const probe = readAgentApiConfig;\n',
    },
    violatedRules: ["api-only-entry-points-open-resources"],
  },
  {
    behavior: "the agent API cannot load the tasks API's code",
    files: {
      "apps/api/src/runtime.ts": "export function createApiRuntime() {}\n",
      "apps/agent-api/src/features/probe.ts":
        'import { createApiRuntime } from "../../../api/src/runtime";\nexport const probe = createApiRuntime;\n',
    },
    violatedRules: ["apps-are-independent"],
  },
  {
    behavior: "agent API code may import the API contract type",
    files: {
      "apps/agent-api/src/probe.ts":
        'import type { App } from "@hackmidwest/api/contract";\nexport type Probe = App;\n',
    },
    violatedRules: [],
  },
  {
    behavior: "agent API code cannot load the tasks table",
    files: {
      "packages/db/src/index.ts": "export const tasks = {};\n",
      "apps/agent-api/src/features/probe.ts":
        'import { tasks } from "../../../../packages/db/src/index";\nexport const probe = tasks;\n',
    },
    violatedRules: ["agent-api-reads-tasks-over-http"],
  },
  {
    behavior: "the agent API cannot open the database through a helper package",
    files: {
      ...DB_CONNECTION_STUB,
      "packages/bridge/index.ts":
        'export { openDatabase } from "../db/src/client";\n',
      "apps/agent-api/src/index.ts":
        'import { openDatabase } from "../../../packages/bridge/index";\nexport const probe = openDatabase;\n',
    },
    violatedRules: ["agent-api-reads-tasks-over-http"],
  },
  {
    behavior:
      "the agent API cannot load the tasks API through a helper package",
    files: {
      "apps/api/src/runtime.ts": "export function createApiRuntime() {}\n",
      "packages/bridge/index.ts":
        'export { createApiRuntime } from "../../apps/api/src/runtime";\n',
      "apps/agent-api/src/features/probe.ts":
        'import { createApiRuntime } from "../../../../packages/bridge/index";\nexport const probe = createApiRuntime;\n',
    },
    violatedRules: ["apps-are-independent"],
  },
  {
    behavior: "agent API code cannot load the API contract at runtime",
    files: {
      "apps/agent-api/src/probe.ts": 'import "@hackmidwest/api/contract";\n',
    },
    violatedRules: ["apps-are-independent"],
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
];

/** Biome rules from biome.json; each probe's `violatedRules` lists Biome rule names such as "style/noProcessEnv". */
const LINT_PROBES: readonly BoundaryProbe[] = [
  {
    behavior: "web cannot import database types",
    files: {
      "apps/web/src/probe.ts":
        'import type { Database } from "@hackmidwest/db";\nexport type Probe = Database;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "web cannot import database source by relative path",
    files: {
      "apps/web/src/probe.ts":
        'import type { Database } from "../../../packages/db/src/client";\nexport type Probe = Database;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "API code cannot import database source by relative path",
    files: {
      "apps/api/src/features/probe.ts":
        'import { tasks } from "../../../../packages/db/src/schema";\nexport const probe = tasks;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "API feature code cannot read process.env",
    files: {
      "apps/api/src/features/probe.ts":
        "export const probe = process.env.DB_PATH;\n",
    },
    violatedRules: ["style/noProcessEnv"],
  },
  {
    behavior: "database code cannot use the Bun global",
    files: {
      "packages/db/src/probe.ts": "export const probe = Bun.env.DB_PATH;\n",
    },
    violatedRules: ["style/noRestrictedGlobals"],
  },
  {
    behavior:
      "agent API code cannot import the API's source types by relative path",
    files: {
      "apps/agent-api/src/features/probe.ts":
        'import type { App } from "../../../api/src/app";\nexport type Probe = App;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "web cannot import the agent API's source types by relative path",
    files: {
      "apps/web/src/probe.ts":
        'import type { RunRequest } from "../../agent-api/src/runtime";\nexport type Probe = RunRequest;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "agent API code may import its own modules by relative path",
    files: {
      "apps/agent-api/src/features/probe.ts":
        'import type { RunRequest } from "../runtime";\nexport type Probe = RunRequest;\n',
    },
    violatedRules: [],
  },
  {
    behavior: "agent API feature code cannot read process.env",
    files: {
      "apps/agent-api/src/features/probe.ts":
        "export const probe = process.env.AGENT_API_PORT;\n",
    },
    violatedRules: ["style/noProcessEnv"],
  },
  {
    behavior: "agent API code cannot use the Bun global",
    files: {
      "apps/agent-api/src/features/probe.ts":
        "export const probe = Bun.env.AGENT_API_PORT;\n",
    },
    violatedRules: ["style/noRestrictedGlobals"],
  },
  {
    behavior: "the agent API entry point may read process.env",
    files: {
      "apps/agent-api/src/index.ts":
        "export const probe = process.env.AGENT_API_PORT;\n",
    },
    violatedRules: [],
  },
  {
    behavior: "the API entry point may read process.env",
    files: {
      "apps/api/src/index.ts": "export const probe = process.env.API_PORT;\n",
    },
    violatedRules: [],
  },
];

function writeSandbox(files: BoundaryProbe["files"]) {
  // macOS tmpdir() is a symlink; resolved import paths must share the sandbox's real prefix.
  const sandbox = realpathSync(
    mkdtempSync(join(tmpdir(), "module-boundaries-")),
  );
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(sandbox, dirname(path)), { recursive: true });
    writeFileSync(join(sandbox, path), source);
  }
  return sandbox;
}

function linkRealInstalls(sandbox: string) {
  for (const directory of INSTALL_DIRECTORIES) {
    mkdirSync(dirname(join(sandbox, directory)), { recursive: true });
    symlinkSync(
      join(REPOSITORY_ROOT, directory),
      join(sandbox, directory),
      "junction",
    );
  }
}

async function cruiseProbe(files: BoundaryProbe["files"]) {
  const sandbox = writeSandbox(files);
  try {
    linkRealInstalls(sandbox);
    const { options, ...ruleSet } = config;
    const roots = readdirSync(sandbox).filter(
      (entry) => entry !== ROOT_INSTALL_DIRECTORY,
    );
    const { output } = await cruise(roots, {
      ...options,
      baseDir: sandbox,
      validate: true,
      ruleSet,
    });
    if (typeof output === "string") {
      throw new Error("Expected a structured cruise result");
    }
    const names = output.summary.violations.map(({ rule }) => rule.name);
    return [...new Set(names)].sort();
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function lintProbe(files: BoundaryProbe["files"]) {
  const sandbox = writeSandbox(files);
  try {
    copyFileSync(
      join(REPOSITORY_ROOT, BIOME_CONFIG),
      join(sandbox, BIOME_CONFIG),
    );
    // The sandbox is not a git checkout, so the config's VCS ignore file is unavailable.
    const result = spawnSync(
      process.execPath,
      [BIOME_LAUNCHER, "lint", "--vcs-enabled=false", ...Object.keys(files)],
      { cwd: sandbox, encoding: "utf8" },
    );
    if (
      result.status !== BIOME_EXIT_CLEAN &&
      result.status !== BIOME_EXIT_DIAGNOSTICS
    ) {
      throw new Error(`Biome failed to run: ${result.stderr}`);
    }
    const output = result.stdout + result.stderr;
    const names = [...output.matchAll(BIOME_RULE)].map(([, rule]) => rule);
    return [...new Set(names)].sort();
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

it.each(PROBES)("$behavior", async ({ files, violatedRules }) => {
  expect(await cruiseProbe(files)).toEqual(violatedRules);
});

it.each(LINT_PROBES)("$behavior", ({ files, violatedRules }) => {
  expect(lintProbe(files)).toEqual(violatedRules);
});
