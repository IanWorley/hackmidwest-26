import { inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  implies,
  isBoolean,
  isJson,
  isNonBlank,
  isSha256Hex,
  isUtcInstant,
  nonBlankChecks,
} from "../checks";

import { decisionMakers, facilities } from "./facilities";
import { employees, NOTIFICATION_CHANNELS } from "./roster";

// Ordered least to most disruptive, so a higher index is a stronger response.
export const POSTURES = [
  "normal",
  "delayed_arrival",
  "early_dismissal",
  "unscheduled_telework",
  "full_closure",
] as const;
export type Posture = (typeof POSTURES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const DECISION_ACTIONS = [
  "accept",
  "override",
  "defer",
  "no_decision",
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export const ACTIONS_WITH_CHOSEN_POSTURE = [
  "accept",
  "override",
] as const satisfies readonly DecisionAction[];
export const ACTIONS_WITH_RECHECK = [
  "defer",
] as const satisfies readonly DecisionAction[];
export const ACTIONS_REQUIRING_REASON = [
  "override",
  "defer",
] as const satisfies readonly DecisionAction[];

/** Trigger messages from 0003 that mean another decision landed on the chain first. */
export const DECISION_CHAIN_MOVED_MESSAGES = [
  "decisions must extend the chain that already holds this recommendation",
  "decisions is add-only: this decision is already superseded; supersede the newest decision instead",
] as const;

export const REASON_CATEGORIES = [
  "local_conditions",
  "road_reports",
  "directive",
  "essential_operations",
  "data_looks_wrong",
  "other",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a re-evaluation is a newer recommendation. */
export const recommendations = sqliteTable(
  "recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    facilityId: integer("facility_id")
      .notNull()
      .references(() => facilities.id),
    evaluatedAt: text("evaluated_at").notNull(),
    asOf: text("as_of").notNull(),
    posture: text("posture", { enum: POSTURES }).notNull(),
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull(),
    decideBy: text("decide_by").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    check(
      "recommendations_evaluated_at_format",
      isUtcInstant(table.evaluatedAt),
    ),
    check("recommendations_as_of_format", isUtcInstant(table.asOf)),
    check(
      "recommendations_posture",
      inArray(table.posture, POSTURES).inlineParams(),
    ),
    check(
      "recommendations_confidence",
      inArray(table.confidence, CONFIDENCE_LEVELS).inlineParams(),
    ),
    check("recommendations_decide_by_format", isUtcInstant(table.decideBy)),
    check("recommendations_snapshot_json", isJson(table.snapshot)),
    check(
      "recommendations_content_hash_sha256",
      isSha256Hex(table.contentHash),
    ),
  ],
);

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a changed decision is a newer row that supersedes it. A recommendation belongs to one decision chain, each decision has at most one successor, and successors stay in their facility, so each recommendation has one linear history. Separate recommendations for a facility each get their own chain; the route decides which one is current. The decider's name and role are copied in because decision_makers rows can change later. */
export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recommendationId: integer("recommendation_id")
      .notNull()
      .references(() => recommendations.id),
    recommendationHash: text("recommendation_hash").notNull(),
    facilityId: integer("facility_id")
      .notNull()
      .references(() => facilities.id),
    action: text("action", { enum: DECISION_ACTIONS }).notNull(),
    chosenPosture: text("chosen_posture", { enum: POSTURES }),
    recheckAt: text("recheck_at"),
    decidedById: integer("decided_by_id")
      .notNull()
      .references(() => decisionMakers.id),
    decidedByName: text("decided_by_name").notNull(),
    decidedByRole: text("decided_by_role").notNull(),
    decidedAt: text("decided_at").notNull(),
    identityVerified: integer("identity_verified", {
      mode: "boolean",
    }).notNull(),
    reasonCategory: text("reason_category", { enum: REASON_CATEGORIES }),
    reasonText: text("reason_text"),
    supersedesDecisionId: integer("supersedes_decision_id").references(
      (): AnySQLiteColumn => decisions.id,
    ),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    uniqueIndex("decisions_one_root_per_recommendation")
      .on(table.recommendationId)
      .where(isNull(table.supersedesDecisionId)),
    uniqueIndex("decisions_one_successor").on(table.supersedesDecisionId),
    ...nonBlankChecks("decisions", table.decidedByName, table.decidedByRole),
    check(
      "decisions_recommendation_hash_sha256",
      isSha256Hex(table.recommendationHash),
    ),
    check(
      "decisions_action",
      inArray(table.action, DECISION_ACTIONS).inlineParams(),
    ),
    check(
      "decisions_chosen_posture",
      sql`(${table.chosenPosture} is not null) = (${inArray(table.action, ACTIONS_WITH_CHOSEN_POSTURE)}) and (${table.chosenPosture} is null or ${inArray(table.chosenPosture, POSTURES)})`.inlineParams(),
    ),
    check("decisions_decided_at_format", isUtcInstant(table.decidedAt)),
    check("decisions_recheck_at_format", isUtcInstant(table.recheckAt)),
    check(
      "decisions_recheck_at_only_for_defer",
      sql`(${table.recheckAt} is not null) = (${inArray(table.action, ACTIONS_WITH_RECHECK)})`.inlineParams(),
    ),
    check(
      "decisions_identity_verified_boolean",
      isBoolean(table.identityVerified),
    ),
    check(
      "decisions_reason_pair",
      sql`(${table.reasonCategory} is null) = (${table.reasonText} is null) and (${table.reasonCategory} is null or ${inArray(table.reasonCategory, REASON_CATEGORIES)} and ${isNonBlank(table.reasonText)})`.inlineParams(),
    ),
    check(
      "decisions_override_and_defer_require_reason",
      implies(
        inArray(table.action, ACTIONS_REQUIRING_REASON),
        isNotNull(table.reasonCategory),
      ),
    ),
    check(
      "decisions_supersede_requires_reason",
      implies(
        isNotNull(table.supersedesDecisionId),
        isNotNull(table.reasonCategory),
      ),
    ),
    check("decisions_content_hash_sha256", isSha256Hex(table.contentHash)),
  ],
);

/** Add-only: migration triggers reject UPDATE, DELETE, and a second dispatch to the same recipient for a decision, and drop an insert that reuses an id. */
export const notificationDispatches = sqliteTable(
  "notification_dispatches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id),
    decisionHash: text("decision_hash").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    sendBy: text("send_by").notNull(),
    recordedAt: text("recorded_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    uniqueIndex("notification_dispatches_decision_employee").on(
      table.decisionId,
      table.employeeId,
    ),
    check(
      "notification_dispatches_decision_hash_sha256",
      isSha256Hex(table.decisionHash),
    ),
    check(
      "notification_dispatches_channel",
      inArray(table.channel, NOTIFICATION_CHANNELS).inlineParams(),
    ),
    check("notification_dispatches_send_by_format", isUtcInstant(table.sendBy)),
    check(
      "notification_dispatches_recorded_at_format",
      isUtcInstant(table.recordedAt),
    ),
    check(
      "notification_dispatches_content_hash_sha256",
      isSha256Hex(table.contentHash),
    ),
  ],
);

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a correction is a newer input. reportedBy is a free name because the reporter may be outside the system. */
export const humanInputs = sqliteTable(
  "human_inputs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id),
    reportedBy: text("reported_by").notNull(),
    reportedAt: text("reported_at").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    ...nonBlankChecks("human_inputs", table.reportedBy, table.text),
    check("human_inputs_reported_at_format", isUtcInstant(table.reportedAt)),
  ],
);
