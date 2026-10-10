// Relative imports keep the fixture inside the sandbox; the workspace symlink points at the real repository.
export const DB_CONNECTION_STUB = {
  "packages/db/src/client.ts":
    "export type Database = object;\nexport function openDatabase() {}\n",
};

export const DB_SCHEMA_STUB = {
  "packages/db/src/schema.ts": "export const tasks = {};\n",
};

export const IMPORT_PROCESS = 'import process from "node:process";\n';

export interface BoundaryProbe {
  readonly behavior: string;
  readonly files: Readonly<Record<string, string>>;
  readonly violatedRules: readonly string[];
}
