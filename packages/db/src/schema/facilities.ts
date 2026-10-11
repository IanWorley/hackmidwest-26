import { between, inArray, ne } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  isLocalTime,
  isLocalTimeRange,
  isPositiveInteger,
  nonBlankChecks,
} from "../checks";

export const HAZARDS = ["winter", "wind", "airQuality"] as const;
export type Hazard = (typeof HAZARDS)[number];

// MnDOT Maintenance Manual Ch. 2 Table 2's route classification of the roads staff commute on, busiest first.
export const ROAD_CLASSES = [
  "superCommuter",
  "urbanCommuter",
  "ruralCommuter",
  "primary",
  "secondary",
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const LATITUDE_RANGE = { min: -90, max: 90 } as const;
export const LONGITUDE_RANGE = { min: -180, max: 180 } as const;

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
    roadClass: text("road_class", { enum: ROAD_CLASSES }).notNull(),
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
      "facilities_road_class",
      inArray(table.roadClass, ROAD_CLASSES).inlineParams(),
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
