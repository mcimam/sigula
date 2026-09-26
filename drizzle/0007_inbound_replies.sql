CREATE TABLE `inbound_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_message_id` text NOT NULL,
	`session` text DEFAULT '' NOT NULL,
	`from_address` text NOT NULL,
	`salesman_id` integer,
	`body` text DEFAULT '' NOT NULL,
	`outcome` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`reply_text` text DEFAULT '' NOT NULL,
	`reply_status` text DEFAULT 'none' NOT NULL,
	`received_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inbound_outcome_check" CHECK("inbound_messages"."outcome" IN ('recorded', 'unrecognized', 'nothing_pending', 'unknown_sender')),
	CONSTRAINT "inbound_reply_status_check" CHECK("inbound_messages"."reply_status" IN ('none', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_messages_provider_id` ON `inbound_messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `inbound_messages_salesman_idx` ON `inbound_messages` (`salesman_id`,`id`);--> statement-breakpoint
ALTER TABLE `notification_items` ADD `position` integer;