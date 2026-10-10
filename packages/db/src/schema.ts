import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const TASK_TITLE_LENGTH = { min: 1, max: 120 } as const;

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    // SQLite DDL cannot contain bind parameters; the named numeric limits become literals.
    check(
      "tasks_title_length",
      sql`length(${table.title}) between ${TASK_TITLE_LENGTH.min} and ${TASK_TITLE_LENGTH.max}`.inlineParams(),
    ),
  ],
);

const AGENT_RUN_STATUSES = [
  "running",
  "completed",
  "refused",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_PROMPT_LENGTH = { min: 1, max: 100_000 } as const;

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status", { enum: AGENT_RUN_STATUSES })
      .notNull()
      .default("running"),
    output: text("output").notNull().default(""),
    stopReason: text("stop_reason"),
  },
  (table) => [
    check(
      "agent_runs_status",
      sql`${table.status} in (${sql.join(
        AGENT_RUN_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})`.inlineParams(),
    ),
    check(
      "agent_runs_prompt_length",
      sql`length(${table.prompt}) between ${AGENT_RUN_PROMPT_LENGTH.min} and ${AGENT_RUN_PROMPT_LENGTH.max}`.inlineParams(),
    ),
  ],
);
