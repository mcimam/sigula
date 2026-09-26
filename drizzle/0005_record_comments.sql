CREATE TABLE `record_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`body` text NOT NULL,
	`author_id` integer,
	`author_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "record_comments_body_check" CHECK(length(trim("record_comments"."body")) > 0)
);
--> statement-breakpoint
CREATE INDEX `record_comments_entity_idx` ON `record_comments` (`entity_type`,`entity_id`,`id`);