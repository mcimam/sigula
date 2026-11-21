CREATE TABLE `export_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_key` text NOT NULL,
	`mode` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`row_count` integer NOT NULL,
	`column_keys` text DEFAULT '[]' NOT NULL,
	`actor_id` integer,
	`actor_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "export_logs_mode_check" CHECK("export_logs"."mode" IN ('filtered', 'selected')),
	CONSTRAINT "export_logs_row_count_check" CHECK("export_logs"."row_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `export_logs_created_idx` ON `export_logs` (`created_at`,`id`);
