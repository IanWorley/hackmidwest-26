CREATE TABLE `building_roster_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`building_id` integer NOT NULL,
	`listed_name` text NOT NULL,
	`employee_id` integer,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `buildings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `decision_makers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee_status_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`reported_by_id` integer NOT NULL,
	`reported_at` text NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employee_status_events_status" CHECK("employee_status_events"."status" in ('working_onsite', 'teleworking', 'not_working')),
	CONSTRAINT "employee_status_events_not_working_requires_note" CHECK(not ("employee_status_events"."status" = 'not_working') or "employee_status_events"."note" is not null),
	CONSTRAINT "employee_status_events_reported_at_format" CHECK("employee_status_events"."reported_at" is strftime('%Y-%m-%dT%H:%M:%fZ', "employee_status_events"."reported_at")),
	CONSTRAINT "employee_status_events_effective_from_format" CHECK("employee_status_events"."effective_from" is strftime('%Y-%m-%dT%H:%M:%fZ', "employee_status_events"."effective_from"))
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assigned_building_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`mobile_phone` text,
	`preferred_channel` text NOT NULL,
	`essential_personnel` integer NOT NULL,
	`telework_eligible` integer NOT NULL,
	`accessibility_needs` text,
	`shift_start` text,
	`shift_end` text,
	`commute_minutes` integer,
	FOREIGN KEY (`assigned_building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employees_preferred_channel" CHECK("employees"."preferred_channel" in ('email', 'sms')),
	CONSTRAINT "employees_essential_personnel_boolean" CHECK("employees"."essential_personnel" in (0, 1)),
	CONSTRAINT "employees_telework_eligible_boolean" CHECK("employees"."telework_eligible" in (0, 1)),
	CONSTRAINT "employees_sms_requires_mobile_phone" CHECK(not ("employees"."preferred_channel" = 'sms') or "employees"."mobile_phone" is not null and trim("employees"."mobile_phone") <> ''),
	CONSTRAINT "employees_shift" CHECK(("employees"."shift_start" is null) = ("employees"."shift_end" is null) and "employees"."shift_start" is strftime('%H:%M', "employees"."shift_start") and "employees"."shift_start" < '24:00' and "employees"."shift_end" is strftime('%H:%M', "employees"."shift_end") and "employees"."shift_end" < '24:00' and "employees"."shift_start" < "employees"."shift_end"),
	CONSTRAINT "employees_commute_minutes_positive" CHECK("employees"."commute_minutes" is null or typeof("employees"."commute_minutes") = 'integer' and "employees"."commute_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`nws_zone` text NOT NULL,
	`timezone` text NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`arrival_window_start` text NOT NULL,
	`arrival_window_end` text NOT NULL,
	`departure_window_start` text NOT NULL,
	`departure_window_end` text NOT NULL,
	`typical_commute_minutes` integer NOT NULL,
	`decision_deadline` text NOT NULL,
	`notification_lead_minutes` integer NOT NULL,
	`decision_maker_id` integer NOT NULL,
	`backup_decision_maker_id` integer NOT NULL,
	FOREIGN KEY (`decision_maker_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`backup_decision_maker_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "facilities_latitude_range" CHECK("facilities"."latitude" between -90 and 90),
	CONSTRAINT "facilities_longitude_range" CHECK("facilities"."longitude" between -180 and 180),
	CONSTRAINT "facilities_hours" CHECK("facilities"."opens_at" is strftime('%H:%M', "facilities"."opens_at") and "facilities"."opens_at" < '24:00' and "facilities"."closes_at" is strftime('%H:%M', "facilities"."closes_at") and "facilities"."closes_at" < '24:00' and "facilities"."opens_at" < "facilities"."closes_at"),
	CONSTRAINT "facilities_arrival_window" CHECK("facilities"."arrival_window_start" is strftime('%H:%M', "facilities"."arrival_window_start") and "facilities"."arrival_window_start" < '24:00' and "facilities"."arrival_window_end" is strftime('%H:%M', "facilities"."arrival_window_end") and "facilities"."arrival_window_end" < '24:00' and "facilities"."arrival_window_start" < "facilities"."arrival_window_end"),
	CONSTRAINT "facilities_departure_window" CHECK("facilities"."departure_window_start" is strftime('%H:%M', "facilities"."departure_window_start") and "facilities"."departure_window_start" < '24:00' and "facilities"."departure_window_end" is strftime('%H:%M', "facilities"."departure_window_end") and "facilities"."departure_window_end" < '24:00' and "facilities"."departure_window_start" < "facilities"."departure_window_end"),
	CONSTRAINT "facilities_decision_deadline_format" CHECK("facilities"."decision_deadline" is strftime('%H:%M', "facilities"."decision_deadline") and "facilities"."decision_deadline" < '24:00'),
	CONSTRAINT "facilities_typical_commute_minutes_positive" CHECK(typeof("facilities"."typical_commute_minutes") = 'integer' and "facilities"."typical_commute_minutes" > 0),
	CONSTRAINT "facilities_notification_lead_minutes_positive" CHECK(typeof("facilities"."notification_lead_minutes") = 'integer' and "facilities"."notification_lead_minutes" > 0),
	CONSTRAINT "facilities_backup_differs" CHECK("facilities"."decision_maker_id" <> "facilities"."backup_decision_maker_id")
);
--> statement-breakpoint
CREATE TABLE `facility_hazards` (
	`facility_id` integer NOT NULL,
	`hazard` text NOT NULL,
	PRIMARY KEY(`facility_id`, `hazard`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "facility_hazards_hazard" CHECK("facility_hazards"."hazard" in ('winter', 'wind', 'airQuality'))
);

--> statement-breakpoint
CREATE TRIGGER `employee_status_events_reject_update` BEFORE UPDATE ON `employee_status_events`
BEGIN
	SELECT RAISE(ABORT, 'employee_status_events is add-only: record a newer event instead of updating one');
END;
--> statement-breakpoint
CREATE TRIGGER `employee_status_events_reject_delete` BEFORE DELETE ON `employee_status_events`
BEGIN
	SELECT RAISE(ABORT, 'employee_status_events is add-only: events cannot be deleted');
END;
--> statement-breakpoint
-- REPLACE deletes the old row without firing delete triggers unless recursive_triggers is on, so an insert that reuses an id is dropped before it can overwrite. IGNORE rather than ABORT keeps ON CONFLICT DO NOTHING seeding idempotent.
CREATE TRIGGER `employee_status_events_keep_existing` BEFORE INSERT ON `employee_status_events`
WHEN EXISTS (SELECT 1 FROM `employee_status_events` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
