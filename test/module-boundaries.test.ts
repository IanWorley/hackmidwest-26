import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { expect, it } from "vitest";
import config from "../.dependency-cruiser";
import { CRUISE_PROBES, LINT_PROBES } from "./boundary-probes";
import type { BoundaryProbe } from "./probe-fixtures";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ROOT_BIOME_CONFIG = /^biome(?:\..+)?\.jsonc$/u;
const WORKSPACE_FILES = ["biome.jsonc", "package.json"];
const PACKAGE_MANIFEST = "package.json";
// Biome's JS launcher, run with the current Node binary so the spawn works on every OS.
const BIOME_LAUNCHER = join(
  REPOSITORY_ROOT,
  "node_modules/@biomejs/biome/bin/biome",
);
const BIOME_EXIT_CLEAN = 0;
const BIOME_EXIT_DIAGNOSTICS = 1;
const BIOME_RULE = /lint\/(?<rule>\w+\/\w+)/gu;
const ROOT_INSTALL_DIRECTORY = "node_modules";
const INSTALL_DIRECTORIES = [
  ROOT_INSTALL_DIRECTORY,
  "apps/api/node_modules",
  "apps/agent-api/node_modules",
  "apps/web/node_modules",
];

function readWorkspaces(): string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, PACKAGE_MANIFEST), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("workspaces" in manifest) ||
    !Array.isArray(manifest.workspaces) ||
    !manifest.workspaces.every((entry) => typeof entry === "string")
  ) {
    throw new Error("package.json must list its workspaces as strings");
  }
  return manifest.workspaces;
}

function copyFromRepository(sandbox: string, path: string): void {
  mkdirSync(dirname(join(sandbox, path)), { recursive: true });
  copyFileSync(join(REPOSITORY_ROOT, path), join(sandbox, path));
}

/** Copies every Biome config and the manifests its dependency rules read, so probes lint as the repository does. */
function copyLintSetup(sandbox: string): void {
  const rootFiles = readdirSync(REPOSITORY_ROOT).filter(
    (name) => ROOT_BIOME_CONFIG.test(name) || name === PACKAGE_MANIFEST,
  );
  for (const name of rootFiles) {
    copyFromRepository(sandbox, name);
  }
  for (const workspace of readWorkspaces()) {
    for (const name of WORKSPACE_FILES) {
      const path = join(workspace, name);
      if (existsSync(join(REPOSITORY_ROOT, path))) {
        copyFromRepository(sandbox, path);
      }
    }
  }
}

function writeSandbox(files: BoundaryProbe["files"]): string {
  // macOS links its temp directory; dependency-cruiser compares resolved paths.
  const sandbox = realpathSync(
    mkdtempSync(join(tmpdir(), "module-boundaries-")),
  );
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(sandbox, dirname(path)), { recursive: true });
    writeFileSync(join(sandbox, path), source);
  }
  return sandbox;
}

function linkRealInstalls(sandbox: string): void {
  for (const directory of INSTALL_DIRECTORIES) {
    mkdirSync(dirname(join(sandbox, directory)), { recursive: true });
    symlinkSync(
      join(REPOSITORY_ROOT, directory),
      join(sandbox, directory),
      "junction",
    );
  }
}

async function cruiseProbe(files: BoundaryProbe["files"]): Promise<string[]> {
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

function lintProbe(files: BoundaryProbe["files"]): string[] {
  const sandbox = writeSandbox(files);
  try {
    copyLintSetup(sandbox);
    linkRealInstalls(sandbox);
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
    const names = [...output.matchAll(BIOME_RULE)].flatMap(
      (match) => match.groups?.rule ?? [],
    );
    return [...new Set(names)].sort();
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

it.each(CRUISE_PROBES)("$behavior", async ({ files, violatedRules }) => {
  expect(await cruiseProbe(files)).toEqual(violatedRules);
});

it.each(LINT_PROBES)("$behavior", ({ files, violatedRules }) => {
  expect(lintProbe(files)).toEqual(violatedRules);
});
