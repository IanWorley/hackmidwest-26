import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createSchemaFactory } from "drizzle-typebox";
import { t } from "elysia";

const MIN_TITLE_LENGTH = 1;
const MAX_TITLE_LENGTH = 120;

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
      sql`length(${table.title}) between ${MIN_TITLE_LENGTH} and ${MAX_TITLE_LENGTH}`.inlineParams(),
    ),
  ],
);

const { createSelectSchema, createInsertSchema } = createSchemaFactory({
  typeboxInstance: t,
});
export const taskResponse = createSelectSchema(tasks);

const taskInsert = createInsertSchema(tasks, {
  title: t.String({ minLength: MIN_TITLE_LENGTH, maxLength: MAX_TITLE_LENGTH }),
});

/** New-task requests cannot set the primary key or completion state. */
export const createTaskBody = t.Object(
  { title: taskInsert.properties.title },
  { additionalProperties: false },
);
