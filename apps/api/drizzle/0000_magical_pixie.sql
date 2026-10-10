CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	CONSTRAINT "tasks_title_length" CHECK(length("tasks"."title") between 1 and 120)
);
