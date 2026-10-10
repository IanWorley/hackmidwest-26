import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const DB_TEST_FIXTURE_STUB = {
  "packages/db/src/testing.ts": "export function createTestDatabase() {}\n",
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
    violatedRules: ["api-config-only-in-entry-point"],
  },
  {
    behavior:
      "API feature code cannot reach the database test fixture through a helper",
    files: {
      ...DB_TEST_FIXTURE_STUB,
      "apps/api/src/features/helper.ts": IMPORT_DB_TEST_FIXTURE,
      "apps/api/src/features/probe.ts": 'import "./helper";\n',
    },
    violatedRules: ["api-db-fixture-only-in-tests"],
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
    violatedRules: ["web-no-server-code"],
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
    behavior: "API feature code cannot import openDatabase",
    files: {
      "apps/api/src/features/probe.ts":
        'import { openDatabase } from "@hackmidwest/db";\nexport const probe = openDatabase;\n',
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
    behavior: "the API entry point may read process.env",
    files: {
      "apps/api/src/index.ts": "export const probe = process.env.API_PORT;\n",
    },
    violatedRules: [],
  },
];

function writeSandbox(files: BoundaryProbe["files"]) {
  const sandbox = mkdtempSync(join(tmpdir(), "module-boundaries-"));
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
