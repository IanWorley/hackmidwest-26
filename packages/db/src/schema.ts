import { between, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
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
} from "./checks";

export const TASK_TITLE_LENGTH = { min: 1, max: 120 } as const;

export const HAZARDS = ["winter", "wind", "airQuality"] as const;
export type Hazard = (typeof HAZARDS)[number];

export const EMPLOYEE_STATUSES = [
  "working_onsite",
  "teleworking",
  "not_working",
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["email", "sms"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

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
export const ACTIONS_REQUIRING_REASON = [
  "override",
  "defer",
] as const satisfies readonly DecisionAction[];

export const REASON_CATEGORIES = [
  "local_conditions",
  "road_reports",
  "directive",
  "essential_operations",
  "data_looks_wrong",
  "other",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const LATITUDE_RANGE = { min: -90, max: 90 } as const;
export const LONGITUDE_RANGE = { min: -180, max: 180 } as const;

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
    check(
      "tasks_title_length",
      sql`length(${table.title}) between ${TASK_TITLE_LENGTH.min} and ${TASK_TITLE_LENGTH.max}`.inlineParams(),
    ),
  ],
);

export const decisionMakers = sqliteTable(
  "decision_makers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    email: text("email").notNull(),
  },
  (table) =>
    nonBlankChecks("decision_makers", table.name, table.role, table.email),
);

export const facilities = sqliteTable(
  "facilities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    nwsZone: text("nws_zone").notNull(),
    timezone: text("timezone").notNull(),
    opensAt: text("opens_at").notNull(),
    closesAt: text("closes_at").notNull(),
    arrivalWindowStart: text("arrival_window_start").notNull(),
    arrivalWindowEnd: text("arrival_window_end").notNull(),
    departureWindowStart: text("departure_window_start").notNull(),
    departureWindowEnd: text("departure_window_end").notNull(),
    typicalCommuteMinutes: integer("typical_commute_minutes").notNull(),
    decisionDeadline: text("decision_deadline").notNull(),
    notificationLeadMinutes: integer("notification_lead_minutes").notNull(),
    decisionMakerId: integer("decision_maker_id")
      .notNull()
      .references(() => decisionMakers.id),
    backupDecisionMakerId: integer("backup_decision_maker_id")
      .notNull()
      .references(() => decisionMakers.id),
  },
  (table) => [
    ...nonBlankChecks("facilities", table.name, table.nwsZone, table.timezone),
    check(
      "facilities_latitude_range",
      between(
        table.latitude,
        LATITUDE_RANGE.min,
        LATITUDE_RANGE.max,
      ).inlineParams(),
    ),
    check(
      "facilities_longitude_range",
      between(
        table.longitude,
        LONGITUDE_RANGE.min,
        LONGITUDE_RANGE.max,
      ).inlineParams(),
    ),
    check("facilities_hours", isLocalTimeRange(table.opensAt, table.closesAt)),
    check(
      "facilities_arrival_window",
      isLocalTimeRange(table.arrivalWindowStart, table.arrivalWindowEnd),
    ),
    check(
      "facilities_departure_window",
      isLocalTimeRange(table.departureWindowStart, table.departureWindowEnd),
    ),
    check(
      "facilities_decision_deadline_format",
      isLocalTime(table.decisionDeadline),
    ),
    check(
      "facilities_typical_commute_minutes_positive",
      isPositiveInteger(table.typicalCommuteMinutes),
    ),
    check(
      "facilities_notification_lead_minutes_positive",
      isPositiveInteger(table.notificationLeadMinutes),
    ),
    check(
      "facilities_backup_differs",
      ne(table.decisionMakerId, table.backupDecisionMakerId),
    ),
  ],
);

/** A facility's hazard profile: the hazards its posture is evaluated against. */
export const facilityHazards = sqliteTable(
  "facility_hazards",
  {
    facilityId: integer("facility_id")
      .notNull()
      .references(() => facilities.id),
    hazard: text("hazard", { enum: HAZARDS }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.facilityId, table.hazard] }),
    check(
      "facility_hazards_hazard",
      inArray(table.hazard, HAZARDS).inlineParams(),
    ),
  ],
);

export const buildings = sqliteTable(
  "buildings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    facilityId: integer("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
  },
  (table) => nonBlankChecks("buildings", table.name),
);

/** The HR roster. An employee's facility is their assigned building's facility. */
export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assignedBuildingId: integer("assigned_building_id")
      .notNull()
      .references(() => buildings.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    mobilePhone: text("mobile_phone"),
    preferredChannel: text("preferred_channel", {
      enum: NOTIFICATION_CHANNELS,
    }).notNull(),
    essentialPersonnel: integer("essential_personnel", {
      mode: "boolean",
    }).notNull(),
    teleworkEligible: integer("telework_eligible", {
      mode: "boolean",
    }).notNull(),
    accessibilityNeeds: text("accessibility_needs"),
    shiftStart: text("shift_start"),
    shiftEnd: text("shift_end"),
    commuteMinutes: integer("commute_minutes"),
  },
  (table) => [
    ...nonBlankChecks("employees", table.name, table.email),
    check(
      "employees_preferred_channel",
      inArray(table.preferredChannel, NOTIFICATION_CHANNELS).inlineParams(),
    ),
    check(
      "employees_essential_personnel_boolean",
      isBoolean(table.essentialPersonnel),
    ),
    check(
      "employees_telework_eligible_boolean",
      isBoolean(table.teleworkEligible),
    ),
    check(
      "employees_sms_requires_mobile_phone",
      implies(
        eq(table.preferredChannel, "sms"),
        sql`${isNotNull(table.mobilePhone)} and ${isNonBlank(table.mobilePhone)}`,
      ),
    ),
    check(
      "employees_shift",
      sql`(${table.shiftStart} is null) = (${table.shiftEnd} is null) and ${isLocalTimeRange(table.shiftStart, table.shiftEnd)}`,
    ),
    check(
      "employees_commute_minutes_positive",
      sql`${table.commuteMinutes} is null or ${isPositiveInteger(table.commuteMinutes)}`,
    ),
  ],
);

/** A building's own roster, which can disagree with HR. A null employee is someone HR does not list. */
export const buildingRosterEntries = sqliteTable(
  "building_roster_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    buildingId: integer("building_id")
      .notNull()
      .references(() => buildings.id),
    listedName: text("listed_name").notNull(),
    employeeId: integer("employee_id").references(() => employees.id),
  },
  (table) => nonBlankChecks("building_roster_entries", table.listedName),
);

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a correction is a newer event. */
export const employeeStatusEvents = sqliteTable(
  "employee_status_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id),
    status: text("status", { enum: EMPLOYEE_STATUSES }).notNull(),
    note: text("note"),
    reportedById: integer("reported_by_id")
      .notNull()
      .references(() => decisionMakers.id),
    reportedAt: text("reported_at").notNull(),
    effectiveFrom: text("effective_from").notNull(),
  },
  (table) => [
    check(
      "employee_status_events_status",
      inArray(table.status, EMPLOYEE_STATUSES).inlineParams(),
    ),
    check(
      "employee_status_events_not_working_requires_note",
      implies(
        eq(table.status, "not_working"),
        sql`${isNotNull(table.note)} and ${isNonBlank(table.note)}`,
      ),
    ),
    check(
      "employee_status_events_reported_at_format",
      isUtcInstant(table.reportedAt),
    ),
    check(
      "employee_status_events_effective_from_format",
      isUtcInstant(table.effectiveFrom),
    ),
  ],
);

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

/** Add-only: migration triggers reject UPDATE and DELETE and drop an insert that reuses an id, so a changed decision is a newer row that supersedes it. */
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
    decidedById: integer("decided_by_id")
      .notNull()
      .references(() => decisionMakers.id),
    decidedAt: text("decided_at").notNull(),
    // Negative when the decision came after decideBy.
    minutesBeforeDecideBy: integer("minutes_before_decide_by").notNull(),
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
    check(
      "decisions_minutes_before_decide_by_integer",
      isInteger(table.minutesBeforeDecideBy),
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
