-- Two data changes, both for answering a reminder in the salesman's own words (ADR-0009).
--
-- 1. A reason of last resort. A follow-up must have a reason (CHECK follow_ups_reason_required), and a salesman
--    who answers "Barang masih ada" is not choosing one of the offered three. That answer is recorded under this
--    row; the words go in follow_ups.note and in the activity. It is never offered as a choice (the app filters
--    the code 'other' out of the lists it shows) and never deactivates a customer.
INSERT INTO `follow_up_reasons` (`code`, `label`, `deactivates_customer`, `sort_order`, `is_active`)
SELECT 'other', 'Lainnya', 0, 99, 1
WHERE NOT EXISTS (SELECT 1 FROM `follow_up_reasons` WHERE `code` = 'other');
--> statement-breakpoint
-- 2. The reminder text to salesmen (WhatsApp), version n+1: it now says how to reply — press Reply on the message,
--    "number + reason" for some customers, the reason alone for all of them, free text allowed.
--    Added as the next version, and only where the text in use is still one of the two this project shipped
--    (migration 0003's, or 0006's): an admin's own text is kept. The unique index allows one active version per
--    code + channel, so the new row goes in inactive, the old one is retired, and only then is the new one switched on.
INSERT INTO `message_templates` (`code`, `channel`, `recipient_kind`, `subject`, `body`, `version`, `is_active`, `created_at`, `created_by_id`)
SELECT 'reminder_salesman', 'whatsapp', 'salesman', '',
	'🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || '*Cara membalas:* tekan Balas (reply) pada pesan ini, lalu tulis:' || char(10) || '• Satu/beberapa customer: nomor + alasan' || char(10) || '  contoh: 3 Kalah Harga  atau  1,2,5 Stok Masih Ada' || char(10) || '• Semua customer: alasannya saja' || char(10) || '  contoh: Stok Masih Ada' || char(10) || 'Pilihan alasan: {{daftar_alasan}}. Boleh juga menulis alasan Anda sendiri.',
	(SELECT max(`version`) + 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp'), 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL
WHERE EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 1 AND `body` IN ('Halo {{nama}}, ada {{jumlah}} customer yang sudah melewati siklus order dan perlu ditindaklanjuti: {{daftar_customer}}.', '🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || 'Balas dengan alasan: {{daftar_alasan}}.'));
--> statement-breakpoint
UPDATE `message_templates` SET `is_active` = 0
WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 1 AND `body` IN ('Halo {{nama}}, ada {{jumlah}} customer yang sudah melewati siklus order dan perlu ditindaklanjuti: {{daftar_customer}}.', '🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || 'Balas dengan alasan: {{daftar_alasan}}.')
	AND EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 0 AND `body` = '🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || '*Cara membalas:* tekan Balas (reply) pada pesan ini, lalu tulis:' || char(10) || '• Satu/beberapa customer: nomor + alasan' || char(10) || '  contoh: 3 Kalah Harga  atau  1,2,5 Stok Masih Ada' || char(10) || '• Semua customer: alasannya saja' || char(10) || '  contoh: Stok Masih Ada' || char(10) || 'Pilihan alasan: {{daftar_alasan}}. Boleh juga menulis alasan Anda sendiri.');
--> statement-breakpoint
UPDATE `message_templates` SET `is_active` = 1
WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 0 AND `body` = '🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}' || char(10) || char(10) || 'Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:' || char(10) || '{{daftar_customer}}' || char(10) || char(10) || '*Cara membalas:* tekan Balas (reply) pada pesan ini, lalu tulis:' || char(10) || '• Satu/beberapa customer: nomor + alasan' || char(10) || '  contoh: 3 Kalah Harga  atau  1,2,5 Stok Masih Ada' || char(10) || '• Semua customer: alasannya saja' || char(10) || '  contoh: Stok Masih Ada' || char(10) || 'Pilihan alasan: {{daftar_alasan}}. Boleh juga menulis alasan Anda sendiri.'
	AND `version` = (SELECT max(`version`) FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp')
	AND NOT EXISTS (SELECT 1 FROM `message_templates` WHERE `code` = 'reminder_salesman' AND `channel` = 'whatsapp' AND `is_active` = 1);
