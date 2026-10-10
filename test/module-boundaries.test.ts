import {
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
    behavior: "build output is not checked",
    files: { "apps/api/dist/index.js": 'import "@libsql/client";\n' },
    violatedRules: [],
  },
];

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
  const sandbox = mkdtempSync(join(tmpdir(), "module-boundaries-"));
  try {
    linkRealInstalls(sandbox);
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(sandbox, dirname(path)), { recursive: true });
      writeFileSync(join(sandbox, path), source);
    }
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

it.each(PROBES)("$behavior", async ({ files, violatedRules }) => {
  expect(await cruiseProbe(files)).toEqual(violatedRules);
});
