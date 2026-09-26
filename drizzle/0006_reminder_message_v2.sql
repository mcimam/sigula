-- Reminder text to salesmen (WhatsApp): the new format — a header with the salesman and the date,
-- a numbered list "NAMA — N hari (siklus normal M hari)" with the longest-waiting customer first,
-- and the reasons a salesman can answer with. New placeholders: {{tanggal}}, {{daftar_alasan}};
-- {{daftar_customer}} is now that numbered list.
--
-- Added as the next version (versions are never edited, ADR-0006), and only where the text is still the
-- one migration 0003 seeded: an admin who already wrote their own text keeps it.
-- Order matters: the unique index allows one active version per code + channel, so the new row goes in
-- inactive, the old one is retired, and only then the new one is switched on.
INSERT INTO `message_templates` (`code`, `channel`, `recipient_kind`, `subject`, `body`, `version`, `is_active`, `created_at`, `created_by_id`)
SELECT 'reminder_salesman', 'whatsapp', 'salesman', '',
	'🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) ||
	'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) ||
	'{{daftar_customer}}' || char(10) || char(10) ||
	'Balas dengan alasan: {{daftar_alasan}}.',
	2, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL
WHERE EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `version` = 1 AND `is_active` = 1);
--> statement-breakpoint
UPDATE `message_templates` SET `is_active` = 0
WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `version` = 1 AND `is_active` = 1
	AND EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `version` = 2);
--> statement-breakpoint
UPDATE `message_templates` SET `is_active` = 1
WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `version` = 2
	AND NOT EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 1);
