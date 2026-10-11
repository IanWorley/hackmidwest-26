import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  type CheckBuilder,
  check,
} from "drizzle-orm/sqlite-core";

// Zero-padded 24-hour `HH:MM`, so string comparison orders local times.
const LOCAL_TIME_FORMAT = "%H:%M";
// Exactly `Date.prototype.toISOString()`, so string comparison orders instants.
const UTC_INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%fZ";

// julianday returns NULL for an impossible value and normalizes overflow (Feb 30
// becomes Mar 2, 24:01 becomes 00:01 the next day), so only a real time in
// exactly this shape survives the round trip. `is` instead of `=` because a
// NULL comparison would pass the CHECK.
// SQLite DDL cannot contain bind parameters, so every CHECK inlines its values.
function hasFormat(column: AnySQLiteColumn, format: string): SQL {
  return sql`${column} is strftime(${format}, julianday(${column}))`.inlineParams();
}

function isLocalTime(column: AnySQLiteColumn): SQL {
  return hasFormat(column, LOCAL_TIME_FORMAT);
}

function isUtcInstant(column: AnySQLiteColumn): SQL {
  return hasFormat(column, UTC_INSTANT_FORMAT);
}

function isLocalTimeRange(start: AnySQLiteColumn, end: AnySQLiteColumn): SQL {
  return sql`${isLocalTime(start)} and ${isLocalTime(end)} and ${start} < ${end}`;
}

// SQLite stores a non-numeric string in an integer column, and TEXT compares above every number.
function isPositiveInteger(column: AnySQLiteColumn): SQL {
  return sql`typeof(${column}) = 'integer' and ${column} > 0`;
}

// Drizzle reads any stored value other than 1 as false, so a stray 2 would flip the flag.
function isBoolean(column: AnySQLiteColumn): SQL {
  return sql`${column} in (0, 1)`;
}

function isNonBlank(column: AnySQLiteColumn): SQL {
  return sql`trim(${column}) <> ''`;
}

// Required free text must say something; NOT NULL alone admits "" and "  ".
function nonBlankChecks(
  tableName: string,
  ...columns: AnySQLiteColumn[]
): CheckBuilder[] {
  return columns.map((column) =>
    check(`${tableName}_${column.name}_not_blank`, isNonBlank(column)),
  );
}

function implies(condition: SQL, requirement: SQL): SQL {
  return sql`not (${condition}) or ${requirement}`.inlineParams();
}

export {
  implies,
  isBoolean,
  isLocalTime,
  isLocalTimeRange,
  isNonBlank,
  isPositiveInteger,
  isUtcInstant,
  nonBlankChecks,
};
