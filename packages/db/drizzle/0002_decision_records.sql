CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recommendation_id` integer NOT NULL,
	`recommendation_hash` text NOT NULL,
	`facility_id` integer NOT NULL,
	`action` text NOT NULL,
	`chosen_posture` text,
	`decided_by_id` integer NOT NULL,
	`decided_by_name` text NOT NULL,
	`decided_by_role` text NOT NULL,
	`decided_at` text NOT NULL,
	`identity_verified` integer NOT NULL,
	`reason_category` text,
	`reason_text` text,
	`supersedes_decision_id` integer,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `recommendations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_id`) REFERENCES `decision_makers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_decided_by_name_not_blank" CHECK(trim("decisions"."decided_by_name", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "decisions_decided_by_role_not_blank" CHECK(trim("decisions"."decided_by_role", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "decisions_recommendation_hash_sha256" CHECK(length("decisions"."recommendation_hash") = 64 and "decisions"."recommendation_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "decisions_action" CHECK("decisions"."action" in ('accept', 'override', 'defer', 'no_decision')),
	CONSTRAINT "decisions_chosen_posture" CHECK(("decisions"."chosen_posture" is not null) = ("decisions"."action" in ('accept', 'override')) and ("decisions"."chosen_posture" is null or "decisions"."chosen_posture" in ('normal', 'delayed_arrival', 'early_dismissal', 'unscheduled_telework', 'full_closure'))),
	CONSTRAINT "decisions_decided_at_format" CHECK("decisions"."decided_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("decisions"."decided_at"))),
	CONSTRAINT "decisions_identity_verified_boolean" CHECK("decisions"."identity_verified" in (0, 1)),
	CONSTRAINT "decisions_reason_pair" CHECK(("decisions"."reason_category" is null) = ("decisions"."reason_text" is null) and ("decisions"."reason_category" is null or "decisions"."reason_category" in ('local_conditions', 'road_reports', 'directive', 'essential_operations', 'data_looks_wrong', 'other') and trim("decisions"."reason_text", char(32, 9, 10, 11, 12, 13)) <> '')),
	CONSTRAINT "decisions_override_and_defer_require_reason" CHECK(not ("decisions"."action" in ('override', 'defer')) or "decisions"."reason_category" is not null),
	CONSTRAINT "decisions_supersede_requires_reason" CHECK(not ("decisions"."supersedes_decision_id" is not null) or "decisions"."reason_category" is not null),
	CONSTRAINT "decisions_content_hash_sha256" CHECK(length("decisions"."content_hash") = 64 and "decisions"."content_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_one_root_per_recommendation` ON `decisions` (`recommendation_id`) WHERE "decisions"."supersedes_decision_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_one_successor` ON `decisions` (`supersedes_decision_id`);--> statement-breakpoint
CREATE TABLE `human_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`reported_by` text NOT NULL,
	`reported_at` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "human_inputs_reported_by_not_blank" CHECK(trim("human_inputs"."reported_by", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "human_inputs_text_not_blank" CHECK(trim("human_inputs"."text", char(32, 9, 10, 11, 12, 13)) <> ''),
	CONSTRAINT "human_inputs_reported_at_format" CHECK("human_inputs"."reported_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("human_inputs"."reported_at")))
);
--> statement-breakpoint
CREATE TABLE `notification_dispatches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`decision_hash` text NOT NULL,
	`employee_id` integer NOT NULL,
	`channel` text NOT NULL,
	`send_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_dispatches_decision_hash_sha256" CHECK(length("notification_dispatches"."decision_hash") = 64 and "notification_dispatches"."decision_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "notification_dispatches_channel" CHECK("notification_dispatches"."channel" in ('email', 'sms')),
	CONSTRAINT "notification_dispatches_send_by_format" CHECK("notification_dispatches"."send_by" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("notification_dispatches"."send_by"))),
	CONSTRAINT "notification_dispatches_recorded_at_format" CHECK("notification_dispatches"."recorded_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("notification_dispatches"."recorded_at"))),
	CONSTRAINT "notification_dispatches_content_hash_sha256" CHECK(length("notification_dispatches"."content_hash") = 64 and "notification_dispatches"."content_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_dispatches_decision_employee` ON `notification_dispatches` (`decision_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`evaluated_at` text NOT NULL,
	`as_of` text NOT NULL,
	`posture` text NOT NULL,
	`confidence` text NOT NULL,
	`decide_by` text NOT NULL,
	`snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recommendations_evaluated_at_format" CHECK("recommendations"."evaluated_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("recommendations"."evaluated_at"))),
	CONSTRAINT "recommendations_as_of_format" CHECK("recommendations"."as_of" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("recommendations"."as_of"))),
	CONSTRAINT "recommendations_posture" CHECK("recommendations"."posture" in ('normal', 'delayed_arrival', 'early_dismissal', 'unscheduled_telework', 'full_closure')),
	CONSTRAINT "recommendations_confidence" CHECK("recommendations"."confidence" in ('low', 'medium', 'high')),
	CONSTRAINT "recommendations_decide_by_format" CHECK("recommendations"."decide_by" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("recommendations"."decide_by"))),
	CONSTRAINT "recommendations_snapshot_json" CHECK(json_valid("recommendations"."snapshot")),
	CONSTRAINT "recommendations_content_hash_sha256" CHECK(length("recommendations"."content_hash") = 64 and "recommendations"."content_hash" not glob '*[^0-9a-f]*')
);

--> statement-breakpoint
CREATE TRIGGER `recommendations_reject_update` BEFORE UPDATE ON `recommendations`
BEGIN
	SELECT RAISE(ABORT, 'recommendations is add-only: record a newer recommendation instead of updating one');
END;
--> statement-breakpoint
CREATE TRIGGER `recommendations_reject_delete` BEFORE DELETE ON `recommendations`
BEGIN
	SELECT RAISE(ABORT, 'recommendations is add-only: recommendations cannot be deleted');
END;
--> statement-breakpoint
-- As in 0001: REPLACE deletes the old row without firing delete triggers unless recursive_triggers is on, so an insert that reuses an id is dropped before it can overwrite.
CREATE TRIGGER `recommendations_keep_existing` BEFORE INSERT ON `recommendations`
WHEN EXISTS (SELECT 1 FROM `recommendations` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_reject_update` BEFORE UPDATE ON `decisions`
BEGIN
	SELECT RAISE(ABORT, 'decisions is add-only: record a superseding decision instead of updating one');
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_reject_delete` BEFORE DELETE ON `decisions`
BEGIN
	SELECT RAISE(ABORT, 'decisions is add-only: decisions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_keep_existing` BEFORE INSERT ON `decisions`
WHEN EXISTS (SELECT 1 FROM `decisions` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
--> statement-breakpoint
-- REPLACE resolves the chain's unique indexes by deleting the conflicting decision, so a second root or successor aborts before that can happen.
CREATE TRIGGER `decisions_reject_second_root` BEFORE INSERT ON `decisions`
WHEN NEW.`supersedes_decision_id` IS NULL AND EXISTS (SELECT 1 FROM `decisions` WHERE `recommendation_id` = NEW.`recommendation_id` AND `supersedes_decision_id` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'decisions is add-only: this recommendation already has a decision; supersede it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_reject_second_successor` BEFORE INSERT ON `decisions`
WHEN NEW.`supersedes_decision_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `decisions` WHERE `supersedes_decision_id` = NEW.`supersedes_decision_id`)
BEGIN
	SELECT RAISE(ABORT, 'decisions is add-only: this decision is already superseded; supersede the newest decision instead');
END;
--> statement-breakpoint
-- The predecessor must already exist for the same facility, which also rejects a decision that supersedes itself.
CREATE TRIGGER `decisions_supersede_same_facility` BEFORE INSERT ON `decisions`
WHEN NEW.`supersedes_decision_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `decisions` WHERE `id` = NEW.`supersedes_decision_id` AND `facility_id` = NEW.`facility_id`)
BEGIN
	SELECT RAISE(ABORT, 'decisions must supersede an earlier decision for the same facility');
END;
--> statement-breakpoint
-- Triggers enforce add-only storage, the decision chain's shape, and that values a row copies from a parent row match it. Ordering, eligibility, and authorization rules belong to the write path.
-- A decision records exactly what its decider saw, so it must agree with the recommendation it references.
CREATE TRIGGER `decisions_match_recommendation` BEFORE INSERT ON `decisions`
WHEN NOT EXISTS (SELECT 1 FROM `recommendations` WHERE `id` = NEW.`recommendation_id` AND `content_hash` = NEW.`recommendation_hash` AND `facility_id` = NEW.`facility_id`)
BEGIN
	SELECT RAISE(ABORT, 'decisions must copy the referenced recommendation''s facility and content hash');
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_match_decider` BEFORE INSERT ON `decisions`
WHEN NOT EXISTS (SELECT 1 FROM `decision_makers` WHERE `id` = NEW.`decided_by_id` AND `name` = NEW.`decided_by_name` AND `role` = NEW.`decided_by_role`)
BEGIN
	SELECT RAISE(ABORT, 'decisions must copy the deciding decision maker''s current name and role');
END;
--> statement-breakpoint
CREATE TRIGGER `decisions_posture_matches_action` BEFORE INSERT ON `decisions`
WHEN (NEW.`action` = 'accept' AND NEW.`chosen_posture` IS NOT (SELECT `posture` FROM `recommendations` WHERE `id` = NEW.`recommendation_id`))
	OR (NEW.`action` = 'override' AND NEW.`chosen_posture` IS (SELECT `posture` FROM `recommendations` WHERE `id` = NEW.`recommendation_id`))
BEGIN
	SELECT RAISE(ABORT, 'decisions must accept the recommended posture or override it with a different one');
END;
--> statement-breakpoint
CREATE TRIGGER `notification_dispatches_match_decision` BEFORE INSERT ON `notification_dispatches`
WHEN NOT EXISTS (SELECT 1 FROM `decisions` WHERE `id` = NEW.`decision_id` AND `content_hash` = NEW.`decision_hash`)
BEGIN
	SELECT RAISE(ABORT, 'notification_dispatches must copy the referenced decision''s content hash');
END;
--> statement-breakpoint
CREATE TRIGGER `notification_dispatches_reject_update` BEFORE UPDATE ON `notification_dispatches`
BEGIN
	SELECT RAISE(ABORT, 'notification_dispatches is add-only: record a dispatch once instead of updating it');
END;
--> statement-breakpoint
CREATE TRIGGER `notification_dispatches_reject_delete` BEFORE DELETE ON `notification_dispatches`
BEGIN
	SELECT RAISE(ABORT, 'notification_dispatches is add-only: dispatches cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `notification_dispatches_keep_existing` BEFORE INSERT ON `notification_dispatches`
WHEN EXISTS (SELECT 1 FROM `notification_dispatches` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
--> statement-breakpoint
-- REPLACE also resolves the decision-recipient unique index by deleting the original row, so a repeat dispatch aborts before that can happen.
CREATE TRIGGER `notification_dispatches_reject_repeat_recipient` BEFORE INSERT ON `notification_dispatches`
WHEN EXISTS (SELECT 1 FROM `notification_dispatches` WHERE `decision_id` = NEW.`decision_id` AND `employee_id` = NEW.`employee_id`)
BEGIN
	SELECT RAISE(ABORT, 'notification_dispatches is add-only: this decision was already dispatched to this recipient');
END;
--> statement-breakpoint
CREATE TRIGGER `human_inputs_reject_update` BEFORE UPDATE ON `human_inputs`
BEGIN
	SELECT RAISE(ABORT, 'human_inputs is add-only: record a newer input instead of updating one');
END;
--> statement-breakpoint
CREATE TRIGGER `human_inputs_reject_delete` BEFORE DELETE ON `human_inputs`
BEGIN
	SELECT RAISE(ABORT, 'human_inputs is add-only: inputs cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `human_inputs_keep_existing` BEFORE INSERT ON `human_inputs`
WHEN EXISTS (SELECT 1 FROM `human_inputs` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(IGNORE);
END;
