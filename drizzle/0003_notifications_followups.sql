-- ERD v2, release R3 "notifications & follow-ups" (ADR-0006). HAND-WRITTEN on top of drizzle-kit's
-- generated DDL (its SQL cannot backfill or convert data). Same runner rules as 0001.
--
--   * salesmen.nomor_wa      -> salesman_contacts (channel whatsapp, primary)
--   * notification_batches   -> notification_runs (ids kept; + voided_at/by/reason)
--   * notification_deliveries rebuilt: run_id, channel, contact, snapshots, attempt, sent_at,
--                            status skipped_no_phone -> skipped_no_contact
--   * customers.notified     -> notification_items (a customer that is notified now is given an item
--                            on its salesman's latest sent salesman message, so it stays pending;
--                            one with no such delivery simply becomes eligible again)
--   * reason_logs + customers.handled_on -> follow_ups + follow_up_reasons
--   * new message_templates (seeded with today's texts; email rows exist but the UI hides them)
--   * app_settings gains is_secret / updated_at / updated_by_id
-- Reference data (follow_up_reasons, message_templates) is seeded here, not in code.
CREATE TABLE `salesman_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`salesman_id` integer NOT NULL,
	`channel` text NOT NULL,
	`address` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "salesman_contacts_channel_check" CHECK(channel IN ('whatsapp', 'email', 'sms', 'push'))
);
--> statement-breakpoint
CREATE INDEX `salesman_contacts_salesman_idx` ON `salesman_contacts` (`salesman_id`,`channel`);
--> statement-breakpoint
CREATE UNIQUE INDEX `salesman_contacts_primary_live` ON `salesman_contacts` (`salesman_id`,`channel`) WHERE is_primary = 1 AND deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO `salesman_contacts` (`salesman_id`, `channel`, `address`, `is_primary`, `is_verified`, `created_at`, `updated_at`, `deleted_at`)
	SELECT `id`, 'whatsapp', trim(`nomor_wa`), 1, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL FROM `salesmen` WHERE trim(`nomor_wa`) <> ''
;
--> statement-breakpoint
CREATE TABLE `follow_up_reasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`deactivates_customer` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_up_reasons_code_unique` ON `follow_up_reasons` (`code`);
--> statement-breakpoint
INSERT INTO `follow_up_reasons` (`code`, `label`, `deactivates_customer`, `sort_order`, `is_active`) VALUES
	('1', 'Kalah Harga', 0, 1, 1), ('2', 'Stok Masih Ada', 0, 2, 1), ('3', 'Sudah Bangkrut', 1, 3, 1)
;
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_kind` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by_id` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "templates_channel_check" CHECK(channel IN ('whatsapp', 'email', 'sms', 'push')),
	CONSTRAINT "templates_kind_check" CHECK(recipient_kind IN ('salesman', 'supervisor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_version` ON `message_templates` (`code`,`channel`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_active` ON `message_templates` (`code`,`channel`) WHERE is_active = 1;
--> statement-breakpoint
INSERT INTO `message_templates` (`code`, `channel`, `recipient_kind`, `subject`, `body`, `version`, `is_active`, `created_at`, `created_by_id`) VALUES
	('reminder_salesman', 'whatsapp', 'salesman', '', 'Halo {{nama}}, ada {{jumlah}} customer yang sudah melewati siklus order dan perlu ditindaklanjuti: {{daftar_customer}}.', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL),
	('reminder_supervisor', 'whatsapp', 'supervisor', '', 'Ringkasan tim {{nama}}: {{jumlah}} customer overdue perlu ditindaklanjuti.', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL),
	('reminder_salesman', 'email', 'salesman', 'SiGula: {{jumlah}} customer perlu ditindaklanjuti', 'Halo {{nama}},' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order dan perlu ditindaklanjuti:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || 'Salam,' || char(10) || 'SiGula', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL),
	('reminder_supervisor', 'email', 'supervisor', 'SiGula: ringkasan tim {{nama}}', 'Ringkasan tim {{nama}}:' || char(10) || char(10) || '{{jumlah}} customer overdue perlu ditindaklanjuti.' || char(10) || char(10) || 'Salam,' || char(10) || 'SiGula', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL)
;
--> statement-breakpoint
CREATE TABLE `notification_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by_id` integer,
	`as_of_date` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`voided_at` text,
	`voided_by_id` integer,
	`void_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`triggered_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_trigger_check" CHECK(trigger IN ('manual', 'scheduled')),
	CONSTRAINT "runs_manual_has_actor" CHECK(trigger <> 'manual' OR triggered_by_id IS NOT NULL)
);
--> statement-breakpoint
-- Every legacy batch was started by a person (triggered_by_id was NOT NULL), so it is 'manual'.
-- as_of_date is the Jakarta calendar date of the batch (UTC+7, no DST).
INSERT INTO `notification_runs` (`id`, `trigger`, `triggered_by_id`, `as_of_date`, `started_at`, `finished_at`, `voided_at`, `voided_by_id`, `void_reason`)
	SELECT b.`id`, 'manual', b.`triggered_by_id`, date(b.`at`, '+7 hours'), b.`at`, b.`at`, NULL, NULL, ''
	FROM (SELECT `id`, `triggered_by_id`,
		CASE WHEN `tanggal` LIKE '%T%' THEN `tanggal` ELSE replace(`tanggal`, ' ', 'T') || 'Z' END AS `at`
		FROM `notification_batches`) b
;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = 'notification_runs'
;
--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'notification_runs', `seq` FROM `sqlite_sequence` WHERE `name` = 'notification_batches'
;
--> statement-breakpoint
CREATE TABLE `__new_notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`salesman_id` integer NOT NULL,
	`recipient_kind` text DEFAULT 'salesman' NOT NULL,
	`channel` text DEFAULT 'whatsapp' NOT NULL,
	`contact_id` integer,
	`address` text DEFAULT '' NOT NULL,
	`template_id` integer,
	`message_body` text DEFAULT '' NOT NULL,
	`customer_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error_message` text DEFAULT '' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `notification_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `salesman_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deliveries_kind_check" CHECK(recipient_kind IN ('salesman', 'supervisor')),
	CONSTRAINT "deliveries_channel_check" CHECK(channel IN ('whatsapp', 'email', 'sms', 'push')),
	CONSTRAINT "deliveries_status_check" CHECK(status IN ('queued', 'sent', 'failed', 'skipped_no_contact'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_deliveries` (`id`, `run_id`, `salesman_id`, `recipient_kind`, `channel`, `contact_id`, `address`, `template_id`, `message_body`, `customer_count`, `status`, `provider_message_id`, `error_message`, `attempt`, `sent_at`)
	SELECT d.`id`, d.`batch_id`, d.`salesman_id`, d.`recipient_kind`, 'whatsapp',
		(SELECT c.`id` FROM `salesman_contacts` c WHERE c.`salesman_id` = d.`salesman_id` AND c.`channel` = 'whatsapp' AND c.`is_primary` = 1),
		COALESCE((SELECT c.`address` FROM `salesman_contacts` c WHERE c.`salesman_id` = d.`salesman_id` AND c.`channel` = 'whatsapp' AND c.`is_primary` = 1), ''),
		NULL, '', d.`customer_count`,
		CASE d.`status` WHEN 'skipped_no_phone' THEN 'skipped_no_contact' ELSE d.`status` END,
		NULL, d.`error_message`, 1,
		CASE WHEN d.`status` = 'sent' THEN (SELECT r.`started_at` FROM `notification_runs` r WHERE r.`id` = d.`batch_id`) END
	FROM `notification_deliveries` d
;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_notification_deliveries'
;
--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_notification_deliveries', `seq` FROM `sqlite_sequence` WHERE `name` = 'notification_deliveries'
;
--> statement-breakpoint
DROP TABLE `notification_deliveries`;
--> statement-breakpoint
ALTER TABLE `__new_notification_deliveries` RENAME TO `notification_deliveries`;
--> statement-breakpoint
CREATE INDEX `deliveries_run_idx` ON `notification_deliveries` (`run_id`);
--> statement-breakpoint
CREATE INDEX `deliveries_salesman_idx` ON `notification_deliveries` (`salesman_id`,`sent_at`);
--> statement-breakpoint
CREATE TABLE `notification_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delivery_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`last_order_date` text,
	`days_overdue` integer NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_items_delivery_customer` ON `notification_items` (`delivery_id`,`customer_id`);
--> statement-breakpoint
CREATE INDEX `notification_items_customer_idx` ON `notification_items` (`customer_id`);
--> statement-breakpoint
-- A customer that is "notified" today keeps waiting for its salesman: attach it to that salesman's
-- latest sent salesman message. days_overdue is measured on the migration day (the real figure is gone).
INSERT INTO `notification_items` (`delivery_id`, `customer_id`, `last_order_date`, `days_overdue`)
	SELECT (SELECT d.`id` FROM `notification_deliveries` d
			WHERE d.`salesman_id` = c.`salesman_id` AND d.`recipient_kind` = 'salesman' AND d.`status` = 'sent'
			ORDER BY d.`id` DESC LIMIT 1),
		c.`id`, c.`last_order_date`,
		CASE WHEN c.`last_order_date` IS NULL THEN 0
			ELSE MAX(0, CAST(julianday(date('now')) - julianday(c.`last_order_date`) AS INTEGER) - c.`order_cycle_days`) END
	FROM `customers` c
	WHERE c.`notified` = 1 AND c.`deleted_at` IS NULL
		AND EXISTS (SELECT 1 FROM `notification_deliveries` d
			WHERE d.`salesman_id` = c.`salesman_id` AND d.`recipient_kind` = 'salesman' AND d.`status` = 'sent')
;
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`salesman_id` integer NOT NULL,
	`notification_item_id` integer,
	`outcome` text NOT NULL,
	`reason_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`follow_up_date` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notification_item_id`) REFERENCES `notification_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reason_id`) REFERENCES `follow_up_reasons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "follow_ups_outcome_check" CHECK(outcome IN ('will_order', 'not_ordering', 'unreachable')),
	CONSTRAINT "follow_ups_reason_required" CHECK(outcome <> 'not_ordering' OR reason_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `follow_ups_customer_idx` ON `follow_ups` (`customer_id`,`follow_up_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_ups_item_unique` ON `follow_ups` (`notification_item_id`);
--> statement-breakpoint
INSERT INTO `follow_ups` (`customer_id`, `salesman_id`, `notification_item_id`, `outcome`, `reason_id`, `note`, `follow_up_date`, `created_at`, `created_by_id`)
	SELECT rl.`customer_id`, rl.`salesman_id`, NULL, 'not_ordering',
		(SELECT r.`id` FROM `follow_up_reasons` r WHERE r.`code` = rl.`kode_alasan`), '', substr(rl.`tanggal`, 1, 10),
		CASE WHEN length(rl.`tanggal`) = 10 THEN rl.`tanggal` || 'T00:00:00Z' ELSE replace(rl.`tanggal`, ' ', 'T') || 'Z' END,
		NULL
	FROM `reason_logs` rl ORDER BY rl.`id`
;
--> statement-breakpoint
DROP TABLE `reason_logs`;
--> statement-breakpoint
DROP TABLE `notification_batches`;
--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `notified`;
--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `handled_on`;
--> statement-breakpoint
ALTER TABLE `salesmen` DROP COLUMN `nomor_wa`;
--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`is_secret` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_id` integer,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_app_settings` (`key`, `value`, `is_secret`, `updated_at`, `updated_by_id`)
	SELECT `key`, `value`, CASE WHEN `key` = 'waha.api_key' THEN 1 ELSE 0 END, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL FROM `app_settings`
;
--> statement-breakpoint
DROP TABLE `app_settings`;
--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;
