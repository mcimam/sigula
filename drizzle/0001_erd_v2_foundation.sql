-- ERD v2, release R1 "foundation" (ADR-0005). HAND-WRITTEN: drizzle-kit produced the
-- snapshot, but its SQL cannot backfill NOT NULL columns, convert data, or keep
-- AUTOINCREMENT counters. Applied by app/db/migrations.server.ts inside one
-- transaction with foreign_keys OFF and a foreign_key_check before commit.
--
-- What changes:
--   * users / salesmen / customers / transaksi get created_at, updated_at, deleted_at
--     (soft delete); transaksi also gets import_batch_id and created/updated/deleted_by_id.
--   * mutation_logs  -> customer_assignments   (who held a customer, and when)
--   * status_logs    -> customer_status_history (from/to + reason)
--   * new import_batches
--   * every stored timestamp becomes ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SSZ'
--   * customer names are unique per salesman case-insensitively, live rows only
--   * activity_logs: entity_type CHECK dropped, 'restore' action allowed
-- Legacy rows have no real creation time: created_at is the migration moment (or the
-- earliest known event for a customer). AUTOINCREMENT counters are carried over so a
-- hard-deleted id is never reused (activity_logs.entity_id still points at those).

CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_by_id` integer NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`imported_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`salesman_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`assigned_by_id` integer,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_assignments_range" CHECK(valid_to IS NULL OR valid_to >= valid_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_assignments_open` ON `customer_assignments` (`customer_id`) WHERE valid_to IS NULL;--> statement-breakpoint
CREATE INDEX `customer_assignments_customer_idx` ON `customer_assignments` (`customer_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `customer_assignments_salesman_idx` ON `customer_assignments` (`salesman_id`);--> statement-breakpoint
CREATE TABLE `customer_status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`changed_by_id` integer,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "status_history_from_check" CHECK(from_status IN ('aktif', 'inactive')),
	CONSTRAINT "status_history_to_check" CHECK(to_status IN ('aktif', 'inactive'))
);
--> statement-breakpoint
CREATE INDEX `status_history_customer_idx` ON `customer_status_history` (`customer_id`,`changed_at`);--> statement-breakpoint

-- mutation_logs with ISO timestamps, read by the customers rebuild and the assignment backfill.
CREATE TEMP VIEW `_mutations` AS
	SELECT `id`, `customer_id`, `dari_salesman_id`, `ke_salesman_id`, `oleh_id`,
		CASE WHEN `tanggal` LIKE '%T%' THEN `tanggal` ELSE replace(`tanggal`, ' ', 'T') || 'Z' END AS `at`
	FROM `mutation_logs`;
--> statement-breakpoint

-- ── users ──────────────────────────────────────────────────────────────────────
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `username`, `password_hash`, `display_name`, `created_at`, `updated_at`, `deleted_at`)
	SELECT `id`, `username`, `password_hash`, `display_name`,
		strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL
	FROM `users`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_users';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_users', `seq` FROM `sqlite_sequence` WHERE `name` = 'users';--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_live` ON `users` (`username`) WHERE deleted_at IS NULL;--> statement-breakpoint

-- ── salesmen ───────────────────────────────────────────────────────────────────
CREATE TABLE `__new_salesmen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nama` text NOT NULL,
	`nomor_wa` text DEFAULT '' NOT NULL,
	`supervisor_id` integer,
	`status` text DEFAULT 'aktif' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`supervisor_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "salesmen_status_check" CHECK(status IN ('aktif', 'inactive')),
	CONSTRAINT "salesman_not_own_supervisor" CHECK(supervisor_id IS NULL OR supervisor_id <> id)
);
--> statement-breakpoint
INSERT INTO `__new_salesmen` (`id`, `nama`, `nomor_wa`, `supervisor_id`, `status`, `created_at`, `updated_at`, `deleted_at`)
	SELECT `id`, `nama`, `nomor_wa`, `supervisor_id`, `status`,
		strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL
	FROM `salesmen`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_salesmen';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_salesmen', `seq` FROM `sqlite_sequence` WHERE `name` = 'salesmen';--> statement-breakpoint
DROP TABLE `salesmen`;--> statement-breakpoint
ALTER TABLE `__new_salesmen` RENAME TO `salesmen`;--> statement-breakpoint
CREATE INDEX `salesmen_supervisor_idx` ON `salesmen` (`supervisor_id`);--> statement-breakpoint

-- ── customers ──────────────────────────────────────────────────────────────────
CREATE TABLE `__new_customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nama` text NOT NULL,
	`salesman_id` integer NOT NULL,
	`tipe_customer` text NOT NULL,
	`order_cycle_days` integer DEFAULT 30 NOT NULL,
	`status_customer` text DEFAULT 'aktif' NOT NULL,
	`last_order_date` text,
	`notified` integer DEFAULT 0 NOT NULL,
	`handled_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customers_tipe_check" CHECK(tipe_customer IN ('lama', 'baru')),
	CONSTRAINT "customers_status_check" CHECK(status_customer IN ('aktif', 'inactive')),
	CONSTRAINT "order_cycle_days_min" CHECK(order_cycle_days >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_customers` (`id`, `nama`, `salesman_id`, `tipe_customer`, `order_cycle_days`, `status_customer`, `last_order_date`, `notified`, `handled_on`, `created_at`, `updated_at`, `deleted_at`)
	SELECT c.`id`, c.`nama`, c.`salesman_id`, c.`tipe_customer`, c.`order_cycle_days`, c.`status_customer`,
		c.`last_order_date`, c.`notified`, c.`handled_on`,
		COALESCE(MIN((SELECT MIN(m.`at`) FROM `_mutations` m WHERE m.`customer_id` = c.`id`), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		COALESCE(MIN((SELECT MIN(m.`at`) FROM `_mutations` m WHERE m.`customer_id` = c.`id`), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		NULL
	FROM `customers` c;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_customers';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_customers', `seq` FROM `sqlite_sequence` WHERE `name` = 'customers';--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_nama_salesman_live` ON `customers` (lower(`nama`), `salesman_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `customers_salesman_idx` ON `customers` (`salesman_id`);--> statement-breakpoint
CREATE INDEX `customers_due_idx` ON `customers` (`status_customer`,`last_order_date`);--> statement-breakpoint

-- ── customer_assignments (backfilled from mutation_logs) ───────────────────────
-- First segment: the holder before the first move (or the current holder if never moved).
INSERT INTO `customer_assignments` (`customer_id`, `salesman_id`, `valid_from`, `valid_to`, `assigned_by_id`, `note`)
	SELECT c.`id`,
		COALESCE((SELECT m.`dari_salesman_id` FROM `_mutations` m WHERE m.`customer_id` = c.`id` ORDER BY m.`at`, m.`id` LIMIT 1), c.`salesman_id`),
		c.`created_at`,
		(SELECT m.`at` FROM `_mutations` m WHERE m.`customer_id` = c.`id` ORDER BY m.`at`, m.`id` LIMIT 1),
		NULL, ''
	FROM `customers` c;
--> statement-breakpoint
-- One segment per move, closed by the next move.
INSERT INTO `customer_assignments` (`customer_id`, `salesman_id`, `valid_from`, `valid_to`, `assigned_by_id`, `note`)
	SELECT m.`customer_id`, m.`ke_salesman_id`, m.`at`,
		(SELECT n.`at` FROM `_mutations` n
			WHERE n.`customer_id` = m.`customer_id` AND (n.`at` > m.`at` OR (n.`at` = m.`at` AND n.`id` > m.`id`))
			ORDER BY n.`at`, n.`id` LIMIT 1),
		m.`oleh_id`, ''
	FROM `_mutations` m;
--> statement-breakpoint
-- Move logs that disagree with customers.salesman_id (edited by hand): trust the customer row.
UPDATE `customer_assignments` SET `valid_to` = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
	WHERE `valid_to` IS NULL AND `salesman_id` <> (SELECT c.`salesman_id` FROM `customers` c WHERE c.`id` = `customer_assignments`.`customer_id`);
--> statement-breakpoint
INSERT INTO `customer_assignments` (`customer_id`, `salesman_id`, `valid_from`, `valid_to`, `assigned_by_id`, `note`)
	SELECT c.`id`, c.`salesman_id`, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL, NULL, 'migrasi: menyelaraskan dengan pemegang saat ini'
	FROM `customers` c
	WHERE NOT EXISTS (SELECT 1 FROM `customer_assignments` a WHERE a.`customer_id` = c.`id` AND a.`valid_to` IS NULL);
--> statement-breakpoint

-- ── transaksi ──────────────────────────────────────────────────────────────────
CREATE TABLE `__new_transaksi` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`salesman_id` integer NOT NULL,
	`tanggal_order` text NOT NULL,
	`sumber` text NOT NULL,
	`import_batch_id` integer,
	`catatan` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_id` integer,
	`updated_at` text NOT NULL,
	`updated_by_id` integer,
	`deleted_at` text,
	`deleted_by_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesman_id`) REFERENCES `salesmen`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaksi_sumber_check" CHECK(sumber IN ('seed', 'import', 'manual'))
);
--> statement-breakpoint
INSERT INTO `__new_transaksi` (`id`, `customer_id`, `salesman_id`, `tanggal_order`, `sumber`, `import_batch_id`, `catatan`, `created_at`, `created_by_id`, `updated_at`, `updated_by_id`, `deleted_at`, `deleted_by_id`)
	SELECT `id`, `customer_id`, `salesman_id`, `tanggal_order`, `sumber`, NULL, `catatan`,
		CASE WHEN length(`tanggal_input`) = 10 THEN `tanggal_input` || 'T00:00:00Z' ELSE replace(`tanggal_input`, ' ', 'T') || 'Z' END,
		NULL,
		CASE WHEN length(`tanggal_input`) = 10 THEN `tanggal_input` || 'T00:00:00Z' ELSE replace(`tanggal_input`, ' ', 'T') || 'Z' END,
		NULL, NULL, NULL
	FROM `transaksi`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_transaksi';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_transaksi', `seq` FROM `sqlite_sequence` WHERE `name` = 'transaksi';--> statement-breakpoint
DROP TABLE `transaksi`;--> statement-breakpoint
ALTER TABLE `__new_transaksi` RENAME TO `transaksi`;--> statement-breakpoint
CREATE INDEX `transaksi_customer_date_idx` ON `transaksi` (`customer_id`,`tanggal_order`);--> statement-breakpoint
CREATE INDEX `transaksi_salesman_date_idx` ON `transaksi` (`salesman_id`,`tanggal_order`);--> statement-breakpoint

-- ── customer_status_history (from status_logs) ─────────────────────────────────
INSERT INTO `customer_status_history` (`customer_id`, `from_status`, `to_status`, `reason`, `changed_by_id`, `changed_at`)
	SELECT `customer_id`,
		CASE `tipe` WHEN 'manual_inactive' THEN 'aktif' ELSE 'inactive' END,
		CASE `tipe` WHEN 'manual_inactive' THEN 'inactive' ELSE 'aktif' END,
		`tipe`, `oleh_id`,
		CASE WHEN `tanggal` LIKE '%T%' THEN `tanggal` ELSE replace(`tanggal`, ' ', 'T') || 'Z' END
	FROM `status_logs` ORDER BY `id`;
--> statement-breakpoint

-- ── activity_logs ──────────────────────────────────────────────────────────────
CREATE TABLE `__new_activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`entity_label` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer,
	`actor_name` text DEFAULT '' NOT NULL,
	`changes` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_action_check" CHECK(action IN ('create', 'update', 'delete', 'restore'))
);
--> statement-breakpoint
INSERT INTO `__new_activity_logs` (`id`, `entity_type`, `entity_id`, `entity_label`, `action`, `actor_id`, `actor_name`, `changes`, `created_at`)
	SELECT `id`, `entity_type`, `entity_id`, `entity_label`, `action`, `actor_id`, `actor_name`, `changes`,
		CASE WHEN `created_at` LIKE '%T%' THEN `created_at` ELSE replace(`created_at`, ' ', 'T') || 'Z' END
	FROM `activity_logs`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_activity_logs';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_activity_logs', `seq` FROM `sqlite_sequence` WHERE `name` = 'activity_logs';--> statement-breakpoint
DROP TABLE `activity_logs`;--> statement-breakpoint
ALTER TABLE `__new_activity_logs` RENAME TO `activity_logs`;--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activity_logs` (`entity_type`,`entity_id`,`id`);--> statement-breakpoint
CREATE INDEX `activity_actor_idx` ON `activity_logs` (`actor_id`,`created_at`);--> statement-breakpoint

-- ── remaining timestamp + retired tables ───────────────────────────────────────
UPDATE `notification_batches` SET `tanggal` = replace(`tanggal`, ' ', 'T') || 'Z' WHERE `tanggal` NOT LIKE '%T%';--> statement-breakpoint
DROP VIEW `_mutations`;--> statement-breakpoint
DROP TABLE `mutation_logs`;--> statement-breakpoint
DROP TABLE `status_logs`;
