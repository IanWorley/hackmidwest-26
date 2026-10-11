CREATE TABLE `decision_directives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`decision_hash` text NOT NULL,
	`scope` text NOT NULL,
	`directive` text NOT NULL,
	`effective_at` text,
	`reason_category` text NOT NULL,
	`reason_text` text NOT NULL,
	`issued_by_id` integer NOT NULL,
	`issued_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decision_directives_reason_text_not_blank" CHECK(trim("decision_directives"."reason_text", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "decision_directives_decision_hash_sha256" CHECK(length("decision_directives"."decision_hash") = 64 and "decision_directives"."decision_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "decision_directives_scope" CHECK("decision_directives"."scope" in ('facility', 'group:essential') or (substr("decision_directives"."scope", 1, instr("decision_directives"."scope", ':') - 1) in ('building', 'employee') and cast(cast(substr("decision_directives"."scope", instr("decision_directives"."scope", ':') + 1) as integer) as text) is substr("decision_directives"."scope", instr("decision_directives"."scope", ':') + 1) and cast(substr("decision_directives"."scope", instr("decision_directives"."scope", ':') + 1) as integer) between 1 and 9007199254740991)),
	CONSTRAINT "decision_directives_directive" CHECK("decision_directives"."directive" in ('report', 'telework', 'dismissed', 'excused')),
	CONSTRAINT "decision_directives_effective_at_format" CHECK("decision_directives"."effective_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("decision_directives"."effective_at"))),
	CONSTRAINT "decision_directives_effective_at_dismissed_only" CHECK(not ("decision_directives"."effective_at" is not null) or "decision_directives"."directive" in ('dismissed')),
	CONSTRAINT "decision_directives_reason_category" CHECK("decision_directives"."reason_category" in ('local_conditions', 'road_reports', 'directive', 'essential_operations', 'data_looks_wrong', 'other')),
	CONSTRAINT "decision_directives_issued_at_format" CHECK("decision_directives"."issued_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("decision_directives"."issued_at"))),
	CONSTRAINT "decision_directives_content_hash_sha256" CHECK(length("decision_directives"."content_hash") = 64 and "decision_directives"."content_hash" not glob '*[^0-9a-f]*')
);

--> statement-breakpoint
CREATE TRIGGER `decision_directives_match_decision` BEFORE INSERT ON `decision_directives`
WHEN NOT EXISTS (SELECT 1 FROM `decisions` WHERE `id` = NEW.`decision_id` AND `content_hash` = NEW.`decision_hash`)
BEGIN
	SELECT RAISE(ABORT, 'decision_directives must copy the referenced decision''s content hash');
END;
--> statement-breakpoint
-- A superseded decision no longer governs the facility, so a directive on it would never take effect.
CREATE TRIGGER `decision_directives_reject_superseded_decision` BEFORE INSERT ON `decision_directives`
WHEN EXISTS (SELECT 1 FROM `decisions` WHERE `supersedes_decision_id` = NEW.`decision_id`)
BEGIN
	SELECT RAISE(ABORT, 'decision_directives must name the newest decision: this decision is already superseded');
END;
--> statement-breakpoint
CREATE TRIGGER `decision_directives_reject_update` BEFORE UPDATE ON `decision_directives`
BEGIN
	SELECT RAISE(ABORT, 'decision_directives is add-only: record a newer directive instead of updating one');
END;
--> statement-breakpoint
CREATE TRIGGER `decision_directives_reject_delete` BEFORE DELETE ON `decision_directives`
BEGIN
	SELECT RAISE(ABORT, 'decision_directives is add-only: directives cannot be deleted');
END;
--> statement-breakpoint
-- As in 0003: REPLACE deletes the old row without firing delete triggers, so an insert that reuses an id is dropped before it can overwrite.
CREATE TRIGGER `decision_directives_keep_existing` BEFORE INSERT ON `decision_directives`
WHEN EXISTS (SELECT 1 FROM `decision_directives` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
