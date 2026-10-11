PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_facilities` (
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
	`commute_road_class` text NOT NULL,
	`decision_deadline` text NOT NULL,
	`notification_lead_minutes` integer NOT NULL,
	`decision_maker_id` integer NOT NULL,
	`backup_decision_maker_id` integer NOT NULL,
	FOREIGN KEY (`decision_maker_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`backup_decision_maker_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "facilities_name_not_blank" CHECK(trim("__new_facilities"."name", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "facilities_nws_zone_not_blank" CHECK(trim("__new_facilities"."nws_zone", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "facilities_timezone_not_blank" CHECK(trim("__new_facilities"."timezone", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "facilities_latitude_range" CHECK("__new_facilities"."latitude" between -90 and 90),
	CONSTRAINT "facilities_longitude_range" CHECK("__new_facilities"."longitude" between -180 and 180),
	CONSTRAINT "facilities_hours" CHECK("__new_facilities"."opens_at" is strftime('%H:%M', julianday("__new_facilities"."opens_at")) and "__new_facilities"."closes_at" is strftime('%H:%M', julianday("__new_facilities"."closes_at")) and "__new_facilities"."opens_at" < "__new_facilities"."closes_at"),
	CONSTRAINT "facilities_arrival_window" CHECK("__new_facilities"."arrival_window_start" is strftime('%H:%M', julianday("__new_facilities"."arrival_window_start")) and "__new_facilities"."arrival_window_end" is strftime('%H:%M', julianday("__new_facilities"."arrival_window_end")) and "__new_facilities"."arrival_window_start" < "__new_facilities"."arrival_window_end"),
	CONSTRAINT "facilities_departure_window" CHECK("__new_facilities"."departure_window_start" is strftime('%H:%M', julianday("__new_facilities"."departure_window_start")) and "__new_facilities"."departure_window_end" is strftime('%H:%M', julianday("__new_facilities"."departure_window_end")) and "__new_facilities"."departure_window_start" < "__new_facilities"."departure_window_end"),
	CONSTRAINT "facilities_decision_deadline_format" CHECK("__new_facilities"."decision_deadline" is strftime('%H:%M', julianday("__new_facilities"."decision_deadline"))),
	CONSTRAINT "facilities_typical_commute_minutes_positive" CHECK(typeof("__new_facilities"."typical_commute_minutes") = 'integer' and "__new_facilities"."typical_commute_minutes" > 0),
	CONSTRAINT "facilities_commute_road_class" CHECK("__new_facilities"."commute_road_class" in ('super_commuter', 'urban_commuter', 'rural_commuter', 'primary', 'secondary')),
	CONSTRAINT "facilities_notification_lead_minutes_positive" CHECK(typeof("__new_facilities"."notification_lead_minutes") = 'integer' and "__new_facilities"."notification_lead_minutes" > 0),
	CONSTRAINT "facilities_backup_differs" CHECK("__new_facilities"."decision_maker_id" <> "__new_facilities"."backup_decision_maker_id")
);
--> statement-breakpoint
-- Existing rows get urban_commuter, whose 5-hour winter buffer is the single buffer they used before this column.
INSERT INTO `__new_facilities`("id", "name", "latitude", "longitude", "nws_zone", "timezone", "opens_at", "closes_at", "arrival_window_start", "arrival_window_end", "departure_window_start", "departure_window_end", "typical_commute_minutes", "commute_road_class", "decision_deadline", "notification_lead_minutes", "decision_maker_id", "backup_decision_maker_id") SELECT "id", "name", "latitude", "longitude", "nws_zone", "timezone", "opens_at", "closes_at", "arrival_window_start", "arrival_window_end", "departure_window_start", "departure_window_end", "typical_commute_minutes", 'urban_commuter', "decision_deadline", "notification_lead_minutes", "decision_maker_id", "backup_decision_maker_id" FROM `facilities`;--> statement-breakpoint
DROP TABLE `facilities`;--> statement-breakpoint
ALTER TABLE `__new_facilities` RENAME TO `facilities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;