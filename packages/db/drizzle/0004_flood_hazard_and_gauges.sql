PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_facility_hazards` (
	`facility_id` integer NOT NULL,
	`hazard` text NOT NULL,
	PRIMARY KEY(`facility_id`, `hazard`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "facility_hazards_hazard" CHECK("__new_facility_hazards"."hazard" in ('winter', 'wind', 'airQuality', 'flood'))
);
--> statement-breakpoint
INSERT INTO `__new_facility_hazards`("facility_id", "hazard") SELECT "facility_id", "hazard" FROM `facility_hazards`;--> statement-breakpoint
DROP TABLE `facility_hazards`;--> statement-breakpoint
ALTER TABLE `__new_facility_hazards` RENAME TO `facility_hazards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `facilities` ADD `nwps_gauge_id` text CONSTRAINT "facilities_nwps_gauge_id_format" CHECK("nwps_gauge_id" glob '[A-Z][A-Z][A-Z][A-Z][0-9]');
