import {
  type BoundaryProbe,
  DB_CONNECTION_STUB,
  DB_SCHEMA_STUB,
  IMPORT_PROCESS,
} from "./probe-fixtures";

export const AGENT_API_CRUISE_PROBES: readonly BoundaryProbe[] = [
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
    behavior: "agent API code may import the API contract type",
    files: {
      "apps/agent-api/src/probe.ts":
        'import type { App } from "@hackmidwest/api/contract";\nexport type Probe = App;\n',
    },
    violatedRules: [],
  },
  {
    behavior: "agent API code cannot load the API contract at runtime",
    files: {
      "apps/agent-api/src/probe.ts": 'import "@hackmidwest/api/contract";\n',
    },
    violatedRules: ["apps-are-independent"],
  },
  {
    behavior: "agent API code cannot load the tasks table",
    files: {
      ...DB_SCHEMA_STUB,
      "apps/agent-api/src/features/probe.ts":
        'import { tasks } from "../../../../packages/db/src/schema";\nexport const probe = tasks;\n',
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
];

export const AGENT_API_LINT_PROBES: readonly BoundaryProbe[] = [
  {
    behavior: "web cannot import the agent API's source types by relative path",
    files: {
      "apps/agent-api/src/runtime.ts": "export type RunRequest = object;\n",
      "apps/web/src/probe.ts":
        'import type { RunRequest } from "../../agent-api/src/runtime";\nexport type Probe = RunRequest;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior:
      "agent API feature code cannot import database source types by relative path",
    files: {
      ...DB_SCHEMA_STUB,
      "apps/agent-api/src/features/probe.ts":
        'import type { tasks } from "../../../../packages/db/src/schema";\nexport type Probe = typeof tasks;\n',
    },
    violatedRules: ["style/noRestrictedImports"],
  },
  {
    behavior: "agent API feature code cannot read process.env",
    files: {
      "apps/agent-api/src/features/probe.ts": `${IMPORT_PROCESS}export const probe = process.env.AGENT_API_PORT;\n`,
    },
    violatedRules: ["style/noProcessEnv"],
  },
  {
    behavior: "agent API code cannot use the Bun global",
    files: {
      "apps/agent-api/src/features/probe.ts":
        "export const probe = Bun.env.AGENT_API_PORT;\n",
    },
    violatedRules: [
      "correctness/noUndeclaredVariables",
      "style/noRestrictedGlobals",
    ],
  },
  {
    behavior: "the agent API entry point may read process.env",
    files: {
      "apps/agent-api/src/index.ts": `${IMPORT_PROCESS}export const probe = process.env.AGENT_API_PORT;\n`,
    },
    violatedRules: [],
  },
];
