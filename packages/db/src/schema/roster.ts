import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  implies,
  isBoolean,
  isLocalTimeRange,
  isNonBlank,
  isPositiveInteger,
  isUtcInstant,
  nonBlankChecks,
} from "../checks";

import { buildings, decisionMakers } from "./facilities";

export const EMPLOYEE_STATUSES = [
  "working_onsite",
  "teleworking",
  "not_working",
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["email", "sms"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

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
