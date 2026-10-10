CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`stop_reason` text,
	CONSTRAINT "agent_runs_status" CHECK("agent_runs"."status" in ('running', 'completed', 'refused', 'failed', 'cancelled')),
	CONSTRAINT "agent_runs_prompt_length" CHECK(length("agent_runs"."prompt") between 1 and 100000)
);
