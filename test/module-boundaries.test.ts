import {
  mkdirSync,
  mkdtempSync,
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
const INSTALL_DIRECTORIES = [
  "node_modules",
  "apps/api/node_modules",
  "apps/web/node_modules",
];

type BoundaryProbe = {
  readonly behavior: string;
  readonly files: Readonly<Record<string, string>>;
  readonly violatedRules: readonly string[];
};

const API_DB_CLIENT_STUB = {
  "apps/api/src/db/client.ts":
    "export type Database = object;\nexport function openDatabase() {}\n",
};

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
    violatedRules: ["web-no-server-code"],
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
    behavior: "API feature code cannot import the database driver",
    files: {
      "apps/api/src/features/probe.ts":
        'import { createClient } from "@libsql/client";\nexport const probe = createClient;\n',
    },
    violatedRules: ["api-driver-only-in-db-client"],
  },
  {
    behavior:
      "API feature code cannot open a connection through Drizzle's libSQL adapter",
    files: {
      "apps/api/src/features/probe.ts":
        'import { drizzle } from "drizzle-orm/libsql";\nexport const probe = drizzle;\n',
    },
    violatedRules: ["api-driver-only-in-db-client"],
  },
  {
    behavior: "API feature code cannot open a database",
    files: {
      ...API_DB_CLIENT_STUB,
      "apps/api/src/features/probe.ts":
        'import { openDatabase } from "../db/client";\nexport const probe = openDatabase;\n',
    },
    violatedRules: ["api-only-entry-points-open-resources"],
  },
  {
    behavior: "API feature code cannot open a database through an entry point",
    files: {
      ...API_DB_CLIENT_STUB,
      "apps/api/test/database.ts":
        'import { openDatabase } from "../src/db/client";\nexport const createTestDatabase = openDatabase;\n',
      "apps/api/src/features/probe.ts":
        'import { createTestDatabase } from "../../test/database";\nexport const probe = createTestDatabase;\n',
    },
    violatedRules: ["api-only-entry-points-open-resources"],
  },
  {
    behavior: "API feature code may import the Database type",
    files: {
      ...API_DB_CLIENT_STUB,
      "apps/api/src/features/probe.ts":
        'import type { Database } from "../db/client";\nexport type Probe = Database;\n',
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
    const { output } = await cruise(["apps"], {
      ...options,
      baseDir: sandbox,
      validate: true,
      ruleSet,
    });
    if (typeof output === "string") {
      throw new Error("Expected a structured cruise result");
    }
    const names = output.summary.violations.map(({ rule }) => rule.name);
    return [...new Set(names)];
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

it.each(PROBES)("$behavior", async ({ files, violatedRules }) => {
  expect(await cruiseProbe(files)).toEqual(violatedRules);
});
