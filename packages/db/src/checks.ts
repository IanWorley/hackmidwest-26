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
function isInteger(column: AnySQLiteColumn): SQL {
  return sql`typeof(${column}) = 'integer'`;
}

function isPositiveInteger(column: AnySQLiteColumn): SQL {
  return sql`${isInteger(column)} and ${column} > 0`;
}

// A lowercase hex SHA-256 digest, the form `node:crypto` produces with `digest("hex")`.
const SHA256_HEX_LENGTH = 64;
const ANY_NON_LOWERCASE_HEX_GLOB = "*[^0-9a-f]*";

function isSha256Hex(column: AnySQLiteColumn): SQL {
  return sql`length(${column}) = ${SHA256_HEX_LENGTH} and ${column} not glob ${ANY_NON_LOWERCASE_HEX_GLOB}`.inlineParams();
}

function isJson(column: AnySQLiteColumn): SQL {
  return sql`json_valid(${column})`;
}

// Drizzle reads any stored value other than 1 as false, so a stray 2 would flip the flag.
function isBoolean(column: AnySQLiteColumn): SQL {
  return sql`${column} in (0, 1)`;
}

// One-argument trim strips only U+0020, so tabs and line breaks are named too.
const ASCII_WHITESPACE_CODE_POINTS = {
  space: 32,
  tab: 9,
  lineFeed: 10,
  verticalTab: 11,
  formFeed: 12,
  carriageReturn: 13,
} as const;

function isNonBlank(column: AnySQLiteColumn): SQL {
  return sql`trim(${column}, char(${sql.raw(Object.values(ASCII_WHITESPACE_CODE_POINTS).join(", "))})) <> ''`;
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
  isInteger,
  isJson,
  isLocalTime,
  isLocalTimeRange,
  isNonBlank,
  isPositiveInteger,
  isSha256Hex,
  isUtcInstant,
  nonBlankChecks,
};
