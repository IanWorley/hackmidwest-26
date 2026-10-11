import { inArray, isNotNull } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { implies, isSha256Hex, isUtcInstant, nonBlankChecks } from "../checks";
import {
  isStoredDirectiveScope,
  type StoredDirectiveScope,
} from "../directive-scope";
import { decisions, REASON_CATEGORIES } from "./decision-records";
import { decisionMakers } from "./facilities";

export const DIRECTIVE_KINDS = [
  "report",
  "telework",
  "dismissed",
  "excused",
] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];
// The resolver reads a release time only on a dismissal, so any other kind cannot carry one.
export const DIRECTIVES_WITH_EFFECTIVE_AT = [
  "dismissed",
] as const satisfies readonly DirectiveKind[];
/** Raised by migration 0006's trigger. The API refuses a superseded decision before inserting, so this guards direct writes. */
export const SUPERSEDED_DECISION_MESSAGE =
  "decision_directives must name the newest decision: this decision is already superseded";

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a changed directive is a newer row. Scope is text because it may name a building, an employee, or neither; parseDirectiveScope reads it. */
export const decisionDirectives = sqliteTable(
  "decision_directives",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id),
    decisionHash: text("decision_hash").notNull(),
    scope: text("scope").$type<StoredDirectiveScope>().notNull(),
    directive: text("directive", { enum: DIRECTIVE_KINDS }).notNull(),
    effectiveAt: text("effective_at"),
    reasonCategory: text("reason_category", {
      enum: REASON_CATEGORIES,
    }).notNull(),
    reasonText: text("reason_text").notNull(),
    issuedById: integer("issued_by_id")
      .notNull()
      .references(() => decisionMakers.id),
    issuedAt: text("issued_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    ...nonBlankChecks("decision_directives", table.reasonText),
    check(
      "decision_directives_decision_hash_sha256",
      isSha256Hex(table.decisionHash),
    ),
    check("decision_directives_scope", isStoredDirectiveScope(table.scope)),
    check(
      "decision_directives_directive",
      inArray(table.directive, DIRECTIVE_KINDS).inlineParams(),
    ),
    check(
      "decision_directives_effective_at_format",
      isUtcInstant(table.effectiveAt),
    ),
    check(
      "decision_directives_effective_at_dismissed_only",
      implies(
        isNotNull(table.effectiveAt),
        inArray(table.directive, DIRECTIVES_WITH_EFFECTIVE_AT),
      ),
    ),
    check(
      "decision_directives_reason_category",
      inArray(table.reasonCategory, REASON_CATEGORIES).inlineParams(),
    ),
    check("decision_directives_issued_at_format", isUtcInstant(table.issuedAt)),
    check(
      "decision_directives_content_hash_sha256",
      isSha256Hex(table.contentHash),
    ),
  ],
);
