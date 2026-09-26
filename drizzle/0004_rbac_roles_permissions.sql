-- ERD v2, release R2 "access control" (ADR-0007). HAND-WRITTEN on top of drizzle-kit's generated DDL.
--
--   * profiles (one role per user) -> users.salesman_id + user_roles (many roles per user)
--   * new roles / permissions / role_permissions (a permission has a data scope: own / team / all)
--   * users gains is_active and last_login_at
--   * roles and permissions are reference data seeded here; `app/lib/permissions.ts` lists the same codes
--     and a test keeps the two in step. The four built-in roles reproduce exactly what each old
--     profiles.role could reach, including the `supervisor` role (kept as a permission bundle).
-- Existing users keep their role and their salesman link; nobody gains or loses access.
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_unique` ON `roles` (`code`);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_code_unique` ON `permissions` (`code`);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` integer NOT NULL,
	`permission_id` integer NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	PRIMARY KEY(`role_id`, `permission_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "role_permissions_scope_check" CHECK(scope IN ('own', 'team', 'all'))
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by_id` integer,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role_id`);
--> statement-breakpoint
INSERT INTO `roles` (`code`, `name`, `description`, `is_system`, `created_at`, `updated_at`) VALUES
	('admin', 'Admin', 'Pengaturan, data master, transaksi, audit, dan pengiriman pengingat', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	('salesman', 'Salesman', 'Menindaklanjuti customer miliknya sendiri', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	('supervisor', 'Supervisor', 'Melihat dan menindaklanjuti tim (bawahan) di hierarki salesman', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	('management', 'Management', 'Ringkasan lintas tim, hanya baca', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
--> statement-breakpoint
INSERT INTO `permissions` (`code`, `description`) VALUES
	('admin.dashboard', 'Dashboard admin: preview dan riwayat pengiriman'),
	('notification.manage', 'Kirim, ulangi, dan batalkan batch pengingat'),
	('transaksi.manage', 'Kelola transaksi (tambah, ubah, hapus, pulihkan, import Excel)'),
	('masterdata.manage', 'Kelola data master: customer, salesman, user'),
	('audit.read', 'Lihat log audit'),
	('settings.manage', 'Kelola pengaturan WAHA, jadwal, dan template pesan'),
	('customer.follow_up', 'Menindaklanjuti customer: alasan tidak order dan catat order'),
	('customer.reactivate', 'Mengaktifkan kembali customer inactive'),
	('team.read', 'Melihat dashboard dan detail tim'),
	('management.read', 'Melihat dashboard manajemen'),
	('report.salesman', 'Ekspor laporan reminder salesman'),
	('report.team', 'Ekspor laporan tim'),
	('report.management', 'Ekspor ringkasan manajemen');
--> statement-breakpoint
INSERT INTO `role_permissions` (`role_id`, `permission_id`, `scope`) VALUES
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'admin.dashboard'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'notification.manage'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'transaksi.manage'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'masterdata.manage'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'audit.read'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'settings.manage'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.salesman'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.team'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'admin'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.management'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'salesman'), (SELECT `id` FROM `permissions` WHERE `code` = 'customer.follow_up'), 'own'),
	((SELECT `id` FROM `roles` WHERE `code` = 'salesman'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.salesman'), 'own'),
	((SELECT `id` FROM `roles` WHERE `code` = 'supervisor'), (SELECT `id` FROM `permissions` WHERE `code` = 'team.read'), 'team'),
	((SELECT `id` FROM `roles` WHERE `code` = 'supervisor'), (SELECT `id` FROM `permissions` WHERE `code` = 'customer.reactivate'), 'team'),
	((SELECT `id` FROM `roles` WHERE `code` = 'supervisor'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.team'), 'team'),
	((SELECT `id` FROM `roles` WHERE `code` = 'management'), (SELECT `id` FROM `permissions` WHERE `code` = 'management.read'), 'all'),
	((SELECT `id` FROM `roles` WHERE `code` = 'management'), (SELECT `id` FROM `permissions` WHERE `code` = 'report.management'), 'all');
--> statement-breakpoint
ALTER TABLE `users` ADD `salesman_id` integer REFERENCES salesmen(id);
--> statement-breakpoint
ALTER TABLE `users` ADD `is_active` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;
--> statement-breakpoint
UPDATE `users` SET `salesman_id` = (SELECT p.`salesman_id` FROM `profiles` p WHERE p.`user_id` = `users`.`id`);
--> statement-breakpoint
INSERT INTO `user_roles` (`user_id`, `role_id`, `granted_at`, `granted_by_id`)
	SELECT p.`user_id`, r.`id`, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL FROM `profiles` p JOIN `roles` r ON r.`code` = p.`role`;
--> statement-breakpoint
CREATE INDEX `users_salesman_idx` ON `users` (`salesman_id`);
--> statement-breakpoint
DROP TABLE `profiles`;
