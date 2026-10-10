CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`stop_reason` text
);
