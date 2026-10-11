import { inArray, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Ordered least to most specific, so a higher index wins when two directives reach one person.
const DIRECTIVE_SCOPE_KINDS = [
  "facility",
  "group",
  "building",
  "employee",
] as const;
type DirectiveScopeKind = (typeof DIRECTIVE_SCOPE_KINDS)[number];

const DIRECTIVE_GROUPS = ["essential"] as const;
type DirectiveGroup = (typeof DIRECTIVE_GROUPS)[number];

type DirectiveScope =
  | { readonly kind: "facility" }
  | { readonly kind: "group"; readonly group: DirectiveGroup }
  | { readonly kind: "building"; readonly buildingId: number }
  | { readonly kind: "employee"; readonly employeeId: number };

/** The `decision_directives.scope` text. A CHECK admits only these shapes with a positive safe-integer id. */
type StoredDirectiveScope =
  | "facility"
  | `group:${DirectiveGroup}`
  | `building:${number}`
  | `employee:${number}`;

const SEPARATOR = ":";
const ID_SCOPE_KINDS = [
  "building",
  "employee",
] as const satisfies readonly DirectiveScopeKind[];
const SCOPES_WITHOUT_ID: readonly StoredDirectiveScope[] = [
  "facility",
  ...DIRECTIVE_GROUPS.map((group) => `group${SEPARATOR}${group}` as const),
];

function isDirectiveGroup(value: string): value is DirectiveGroup {
  const groups: readonly string[] = DIRECTIVE_GROUPS;
  return groups.includes(value);
}

// Canonical digits only, so a parsed id formats back to the same text.
function parseId(text: string): number | null {
  const id = Number(text);
  if (Number.isSafeInteger(id) && id > 0 && String(id) === text) {
    return id;
  }
  return null;
}

function formatDirectiveScope(scope: DirectiveScope): StoredDirectiveScope {
  switch (scope.kind) {
    case "facility":
      return "facility";
    case "group":
      return `group${SEPARATOR}${scope.group}`;
    case "building":
      return `building${SEPARATOR}${scope.buildingId}`;
    case "employee":
      return `employee${SEPARATOR}${scope.employeeId}`;
    default:
      return scope satisfies never;
  }
}

/** The inverse of formatDirectiveScope; null for any text it would not produce. */
function parseDirectiveScope(stored: string): DirectiveScope | null {
  if (stored === "facility") {
    return { kind: "facility" };
  }
  const separatorAt = stored.indexOf(SEPARATOR);
  if (separatorAt < 0) {
    return null;
  }
  const kind = stored.slice(0, separatorAt);
  const value = stored.slice(separatorAt + 1);
  if (kind === "group") {
    if (isDirectiveGroup(value)) {
      return { kind, group: value };
    }
    return null;
  }
  const id = parseId(value);
  if (id === null) {
    return null;
  }
  if (kind === "building") {
    return { kind, buildingId: id };
  }
  if (kind === "employee") {
    return { kind, employeeId: id };
  }
  return null;
}

// The SQL twin of parseDirectiveScope. Casting the id to an integer and back
// rejects signs, leading zeros, and stray characters; a value past SQLite's
// integer range saturates and fails the round trip too.
function isStoredDirectiveScope(column: AnySQLiteColumn): SQL {
  const kind = sql`substr(${column}, 1, instr(${column}, ${SEPARATOR}) - 1)`;
  const id = sql`substr(${column}, instr(${column}, ${SEPARATOR}) + 1)`;
  return sql`${inArray(column, SCOPES_WITHOUT_ID)} or (${kind} in ${ID_SCOPE_KINDS} and cast(cast(${id} as integer) as text) is ${id} and cast(${id} as integer) between 1 and ${Number.MAX_SAFE_INTEGER})`.inlineParams();
}

export type {
  DirectiveGroup,
  DirectiveScope,
  DirectiveScopeKind,
  StoredDirectiveScope,
};
export {
  DIRECTIVE_GROUPS,
  DIRECTIVE_SCOPE_KINDS,
  formatDirectiveScope,
  isStoredDirectiveScope,
  parseDirectiveScope,
};
