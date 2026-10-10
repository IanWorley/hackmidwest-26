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
