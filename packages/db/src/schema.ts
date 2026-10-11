import {
  between,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Zero-padded 24-hour `HH:MM`, so string comparison orders local times.
const LOCAL_TIME_GLOB = "[0-2][0-9]:[0-5][0-9]";
// Exactly `Date.prototype.toISOString()`, so string comparison orders instants.
const UTC_INSTANT_GLOB =
  "[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z";

// SQLite DDL cannot contain bind parameters, so every CHECK inlines its values.
function isLocalTime(column: AnySQLiteColumn): SQL {
  return sql`${column} glob ${LOCAL_TIME_GLOB}`.inlineParams();
}

function isUtcInstant(column: AnySQLiteColumn): SQL {
  return sql`${column} glob ${UTC_INSTANT_GLOB}`.inlineParams();
}

function isLocalTimeRange(start: AnySQLiteColumn, end: AnySQLiteColumn): SQL {
  return sql`${isLocalTime(start)} and ${isLocalTime(end)} and ${start} < ${end}`;
}

function implies(condition: SQL, requirement: SQL): SQL {
  return sql`not (${condition}) or ${requirement}`.inlineParams();
}

export const TASK_TITLE_LENGTH = { min: 1, max: 120 } as const;

export const HAZARDS = ["winter_storm", "severe_wind", "air_quality"] as const;
export type Hazard = (typeof HAZARDS)[number];

export const EMPLOYEE_STATUSES = [
  "working_onsite",
  "teleworking",
  "not_working",
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["email", "sms"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

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

export const decisionMakers = sqliteTable("decision_makers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  email: text("email").notNull(),
});

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
      gt(table.typicalCommuteMinutes, 0).inlineParams(),
    ),
    check(
      "facilities_notification_lead_minutes_positive",
      gt(table.notificationLeadMinutes, 0).inlineParams(),
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

export const buildings = sqliteTable("buildings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  facilityId: integer("facility_id")
    .notNull()
    .references(() => facilities.id),
  name: text("name").notNull(),
});

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
    check(
      "employees_preferred_channel",
      inArray(table.preferredChannel, NOTIFICATION_CHANNELS).inlineParams(),
    ),
    check(
      "employees_sms_requires_mobile_phone",
      implies(eq(table.preferredChannel, "sms"), isNotNull(table.mobilePhone)),
    ),
    check(
      "employees_shift",
      sql`(${table.shiftStart} is null) = (${table.shiftEnd} is null) and ${isLocalTimeRange(table.shiftStart, table.shiftEnd)}`,
    ),
    check(
      "employees_commute_minutes_positive",
      gt(table.commuteMinutes, 0).inlineParams(),
    ),
  ],
);

/** A building's own roster, which can disagree with HR. A null employee is someone HR does not list. */
export const buildingRosterEntries = sqliteTable("building_roster_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  buildingId: integer("building_id")
    .notNull()
    .references(() => buildings.id),
  listedName: text("listed_name").notNull(),
  employeeId: integer("employee_id").references(() => employees.id),
});

/** Add-only: migration triggers reject UPDATE and DELETE, so a correction is a newer event. */
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
      implies(eq(table.status, "not_working"), isNotNull(table.note)),
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
