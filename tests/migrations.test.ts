import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { applyLegacyBaseline } from "~/db/migrate.server";
import { runMigrations } from "~/db/migrations.server";
import * as schema from "~/db/schema";

import { firstMigrations } from "./helpers/migrations";

type Row = Record<string, unknown>;

/** An ADR-0004-shaped database, i.e. what production has before the migration system. */
function legacyDb() {
  const dbh = new Database(":memory:");
  dbh.pragma("foreign_keys = ON");
  applyLegacyBaseline(dbh);
  return dbh;
}

function upgraded(seed?: (dbh: Database.Database) => void) {
  const dbh = legacyDb();
  seed?.(dbh);
  runMigrations(dbh);
  return dbh;
}

const all = (dbh: Database.Database, sql: string, ...params: unknown[]) =>
  dbh.prepare(sql).all(...params) as Row[];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

describe("migrated schema matches schema.ts", () => {
  const dbh = upgraded();
  const tables = [
    ...new Map(
      (Object.values(schema) as unknown[])
        .filter((v): v is SQLiteTable => is(v, SQLiteTable))
        .map((t) => [getTableConfig(t).name, getTableConfig(t)]),
    ).values(),
  ];

  it("has exactly the tables schema.ts declares (plus drizzle's bookkeeping)", () => {
    const names = all(
      dbh,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
      .map((r) => r.name as string)
      .filter((n) => n !== "__drizzle_migrations")
      .sort();
    expect(names).toEqual(tables.map((t) => t.name).sort());
  });

  for (const table of tables) {
    it(`${table.name}: columns, nullability, keys, foreign keys and indexes`, () => {
      const info = all(dbh, `PRAGMA table_info(${table.name})`);
      expect(info.map((c) => c.name).sort()).toEqual(table.columns.map((c) => c.name).sort());
      // A composite primary key is declared on the table, not per column.
      const compositePk = new Set(table.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
      for (const col of table.columns) {
        const actual = info.find((c) => c.name === col.name)!;
        // A primary key is reported notnull=0 by SQLite for INTEGER PRIMARY KEY.
        if (!col.primary) expect(actual.notnull === 1, `${table.name}.${col.name} NOT NULL`).toBe(col.notNull);
        expect(Number(actual.pk) > 0, `${table.name}.${col.name} PK`).toBe(col.primary || compositePk.has(col.name));
      }

      const fks = all(dbh, `PRAGMA foreign_key_list(${table.name})`);
      for (const fk of table.foreignKeys) {
        const ref = fk.reference();
        const match = fks.find(
          (f) => f.from === ref.columns[0].name && f.table === getTableConfig(ref.foreignTable).name,
        );
        expect(match, `${table.name}.${ref.columns[0].name} FK`).toBeDefined();
        expect(String(match!.on_delete).toLowerCase()).toBe(
          (fk.onDelete ?? "no action").toLowerCase(),
        );
      }
      expect(fks).toHaveLength(table.foreignKeys.length);

      const indexNames = all(dbh, `PRAGMA index_list(${table.name})`).map((i) => i.name);
      for (const idx of table.indexes) expect(indexNames).toContain(idx.config.name);
    });
  }
});

describe("upgrading a legacy database", () => {
  const seedLegacy = (dbh: Database.Database) => {
    dbh.exec(`
      INSERT INTO users (id, username, password_hash, display_name) VALUES
        (1, 'admin', 'x', 'Admin'), (2, 'sales', 'x', 'Sales'), (3, 'gone', 'x', 'Gone');
      DELETE FROM users WHERE id = 3;  -- AUTOINCREMENT must remember 3 was used
      INSERT INTO salesmen (id, nama, nomor_wa, supervisor_id, status) VALUES
        (1, 'Boss', '628111', NULL, 'aktif'), (2, 'Andi', '628222', 1, 'aktif'), (3, 'Citra', '', 1, 'aktif');
      INSERT INTO users (id, username, password_hash, display_name) VALUES (4, 'boss', 'x', 'Boss'), (5, 'exec', 'x', 'Exec');
      INSERT INTO profiles (user_id, role, salesman_id) VALUES
        (1, 'admin', NULL), (2, 'salesman', 2), (4, 'supervisor', 1), (5, 'management', NULL);
      INSERT INTO customers (id, nama, salesman_id, tipe_customer, last_order_date) VALUES
        (1, 'Toko Stay', 2, 'lama', '2026-09-01'),   -- never moved
        (2, 'Toko Moved', 3, 'lama', '2026-08-01'),  -- 2 -> 3 on 2026-05-01
        (3, 'Toko Twice', 2, 'baru', NULL),          -- 1 -> 3 -> 2
        (4, 'Toko Drift', 3, 'lama', NULL);          -- move log says 2, row says 3
      INSERT INTO mutation_logs (customer_id, dari_salesman_id, ke_salesman_id, tanggal, oleh_id) VALUES
        (2, 2, 3, '2026-05-01 09:00:00', 1),
        (3, 1, 3, '2026-06-01 10:00:00', 1),
        (3, 3, 2, '2026-07-01 11:00:00', 1),
        (4, 3, 2, '2026-06-15 08:00:00', 1);
      INSERT INTO transaksi (customer_id, salesman_id, tanggal_order, sumber, tanggal_input, catatan) VALUES
        (1, 2, '2026-09-01', 'import', '2026-09-02', 'first'), (2, 3, '2026-08-01', 'manual', '2026-08-02', '');
      INSERT INTO status_logs (customer_id, tipe, tanggal, oleh_id) VALUES
        (2, 'manual_inactive', '2026-05-05 07:00:00', 2),
        (2, 'auto_reactivation', '2026-05-06 07:00:00', NULL);
      INSERT INTO activity_logs (entity_type, entity_id, entity_label, action, actor_name, created_at)
        VALUES ('customer', 2, 'Toko Moved', 'update', 'Admin', '2026-05-01 09:00:00');
      INSERT INTO notification_batches (tanggal, triggered_by_id) VALUES ('2026-09-10 01:02:03', 1);
      INSERT INTO notification_batches (id, tanggal, triggered_by_id) VALUES (2, '2026-09-11 00:00:00', 1);
      DELETE FROM notification_batches WHERE id = 2;  -- the counter must still remember 2
      INSERT INTO notification_deliveries (batch_id, salesman_id, recipient_kind, customer_count, status, error_message) VALUES
        (1, 2, 'salesman', 1, 'sent', ''),                 -- Andi: sent, so Toko Stay stays pending
        (1, 3, 'salesman', 1, 'skipped_no_phone', ''),     -- Citra: no number, Toko Moved is not pending
        (1, 1, 'supervisor', 2, 'failed', 'down');
      UPDATE customers SET notified = 1 WHERE id IN (1, 2);
      UPDATE customers SET handled_on = '2026-09-05' WHERE id = 1;
      INSERT INTO reason_logs (customer_id, salesman_id, tanggal, kode_alasan) VALUES (2, 3, '2026-08-05', '2'), (1, 2, '2026-09-05', '3');
      INSERT INTO app_settings (key, value) VALUES ('waha.api_key', 's3cret'), ('waha.base_url', 'http://waha.test');
    `);
  };

  it("keeps every row and converts every timestamp to ISO-8601 UTC", () => {
    const dbh = upgraded(seedLegacy);
    for (const [table, n] of [
      ["users", 4],
      ["salesmen", 3],
      ["customers", 4],
      ["transaksi", 2],
      ["activity_logs", 1],
      ["notification_runs", 1],
    ] as const) {
      expect(all(dbh, `SELECT * FROM ${table}`), table).toHaveLength(n);
    }
    for (const [table, column] of [
      ["users", "created_at"],
      ["salesmen", "created_at"],
      ["customers", "created_at"],
      ["transaksi", "created_at"],
      ["activity_logs", "created_at"],
      ["notification_runs", "started_at"],
    ] as const) {
      for (const row of all(dbh, `SELECT ${column} AS v FROM ${table}`)) {
        expect(row.v, `${table}.${column}`).toMatch(ISO);
      }
    }
    expect(all(dbh, "SELECT created_at FROM transaksi ORDER BY id")[0].created_at).toBe(
      "2026-09-02T00:00:00Z",
    );
    expect(all(dbh, "SELECT created_at FROM activity_logs")[0].created_at).toBe("2026-05-01T09:00:00Z");
    expect(all(dbh, "SELECT deleted_at FROM customers").every((r) => r.deleted_at === null)).toBe(true);
  });

  it("retires mutation_logs and status_logs", () => {
    const dbh = upgraded(seedLegacy);
    const names = all(dbh, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    expect(names).not.toContain("mutation_logs");
    expect(names).not.toContain("status_logs");
    expect(all(dbh, "SELECT name FROM sqlite_temp_master WHERE type = 'view'")).toHaveLength(0);
  });

  it("rebuilds who-held-what history from the move log", () => {
    const dbh = upgraded(seedLegacy);
    const history = (customerId: number) =>
      all(
        dbh,
        "SELECT salesman_id, valid_from, valid_to, assigned_by_id FROM customer_assignments WHERE customer_id = ? ORDER BY valid_from, id",
        customerId,
      );

    const stay = history(1);
    expect(stay).toHaveLength(1);
    expect(stay[0]).toMatchObject({ salesman_id: 2, valid_to: null });

    const moved = history(2);
    expect(moved.map((h) => h.salesman_id)).toEqual([2, 3]);
    expect(moved[0].valid_to).toBe("2026-05-01T09:00:00Z");
    expect(moved[1]).toMatchObject({ valid_from: "2026-05-01T09:00:00Z", valid_to: null, assigned_by_id: 1 });

    const twice = history(3);
    expect(twice.map((h) => h.salesman_id)).toEqual([1, 3, 2]);
    expect(twice[0].valid_to).toBe(twice[1].valid_from);
    expect(twice[1].valid_to).toBe(twice[2].valid_from);
    expect(twice[2].valid_to).toBeNull();
  });

  it("gives every customer exactly one open assignment, matching customers.salesman_id", () => {
    const dbh = upgraded(seedLegacy);
    const rows = all(
      dbh,
      `SELECT c.id, c.salesman_id AS holder,
         (SELECT count(*) FROM customer_assignments a WHERE a.customer_id = c.id AND a.valid_to IS NULL) AS open,
         (SELECT a.salesman_id FROM customer_assignments a WHERE a.customer_id = c.id AND a.valid_to IS NULL) AS open_holder
       FROM customers c`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.open, `customer ${r.id}`).toBe(1);
      expect(r.open_holder, `customer ${r.id}`).toBe(r.holder);
    }
    // customer 4: the log said Andi (2), the row says Citra (3) — the row wins, visibly.
    const drift = all(dbh, "SELECT salesman_id, note FROM customer_assignments WHERE customer_id = 4 AND valid_to IS NULL");
    expect(drift[0]).toMatchObject({ salesman_id: 3 });
    expect(String(drift[0].note)).toContain("migrasi");
  });

  it("turns status_logs into from/to transitions", () => {
    const dbh = upgraded(seedLegacy);
    const rows = all(
      dbh,
      "SELECT from_status, to_status, reason, changed_by_id, changed_at FROM customer_status_history ORDER BY id",
    );
    expect(rows).toEqual([
      { from_status: "aktif", to_status: "inactive", reason: "manual_inactive", changed_by_id: 2, changed_at: "2026-05-05T07:00:00Z" },
      { from_status: "inactive", to_status: "aktif", reason: "auto_reactivation", changed_by_id: null, changed_at: "2026-05-06T07:00:00Z" },
    ]);
  });

  it("never reuses an id that was already handed out (AUTOINCREMENT counters carry over)", () => {
    const dbh = upgraded(seedLegacy);
    dbh
      .prepare("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES ('new', 'x', 'New', ?, ?)")
      .run("2026-09-26T00:00:00Z", "2026-09-26T00:00:00Z");
    expect(all(dbh, "SELECT id FROM users WHERE username = 'new'")[0].id).toBe(6);
  });

  it("passes the foreign key check", () => {
    const dbh = upgraded(seedLegacy);
    expect(dbh.pragma("foreign_key_check")).toEqual([]);
    expect(dbh.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("makes customer names unique per salesman ignoring case, for live rows only", () => {
    const dbh = upgraded(seedLegacy);
    const insert = (nama: string, deleted: string | null) =>
      dbh
        .prepare(
          `INSERT INTO customers (nama, salesman_id, tipe_customer, created_at, updated_at, deleted_at)
           VALUES (?, 2, 'lama', '2026-09-26T00:00:00Z', '2026-09-26T00:00:00Z', ?)`,
        )
        .run(nama, deleted);
    expect(() => insert("TOKO STAY", null)).toThrow(/UNIQUE/);
    expect(() => insert("toko stay", "2026-09-26T01:00:00Z")).not.toThrow(); // a deleted twin is fine
  });

  describe("R2: access control", () => {
    it("turns each profile into a user_role and moves the salesman link onto the user", () => {
      const dbh = upgraded(seedLegacy);
      expect(
        all(
          dbh,
          `SELECT u.username, r.code AS role, u.salesman_id, u.is_active, u.last_login_at
           FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id ORDER BY u.id`,
        ),
      ).toEqual([
        { username: "admin", role: "admin", salesman_id: null, is_active: 1, last_login_at: null },
        { username: "sales", role: "salesman", salesman_id: 2, is_active: 1, last_login_at: null },
        { username: "boss", role: "supervisor", salesman_id: 1, is_active: 1, last_login_at: null },
        { username: "exec", role: "management", salesman_id: null, is_active: 1, last_login_at: null },
      ]);
      expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'profiles'")).toHaveLength(0);
      expect(all(dbh, "SELECT granted_by_id FROM user_roles").every((r) => r.granted_by_id === null)).toBe(true);
    });

    it("seeds the four built-in roles as system roles and a scope for every grant", () => {
      const dbh = upgraded(seedLegacy);
      expect(all(dbh, "SELECT code, is_system FROM roles ORDER BY id")).toEqual([
        { code: "admin", is_system: 1 },
        { code: "salesman", is_system: 1 },
        { code: "supervisor", is_system: 1 },
        { code: "management", is_system: 1 },
      ]);
      expect(all(dbh, "SELECT count(*) AS n FROM role_permissions")[0].n).toBe(9 + 2 + 3 + 2);
      expect(all(dbh, "SELECT count(*) AS n FROM permissions")[0].n).toBe(13);
    });

    it("cascades: removing a role or a user removes the grants that point at it", () => {
      const dbh = upgraded(seedLegacy);
      dbh.pragma("foreign_keys = ON");
      dbh.prepare("DELETE FROM users WHERE id = 5").run();
      expect(all(dbh, "SELECT * FROM user_roles WHERE user_id = 5")).toHaveLength(0);
    });
  });

  describe("R3: notifications and follow-ups", () => {
    it("moves nomor_wa into a primary whatsapp contact (none for a blank number)", () => {
      const dbh = upgraded(seedLegacy);
      expect(all(dbh, "SELECT salesman_id, channel, address, is_primary FROM salesman_contacts ORDER BY salesman_id")).toEqual([
        { salesman_id: 1, channel: "whatsapp", address: "628111", is_primary: 1 },
        { salesman_id: 2, channel: "whatsapp", address: "628222", is_primary: 1 },
      ]);
      expect(all(dbh, "PRAGMA table_info(salesmen)").map((c) => c.name)).not.toContain("nomor_wa");
    });

    it("turns batches into runs keeping ids and the id counter", () => {
      const dbh = upgraded(seedLegacy);
      expect(all(dbh, "SELECT id, trigger, triggered_by_id, as_of_date, started_at, finished_at, voided_at FROM notification_runs")).toEqual([
        { id: 1, trigger: "manual", triggered_by_id: 1, as_of_date: "2026-09-10", started_at: "2026-09-10T01:02:03Z", finished_at: "2026-09-10T01:02:03Z", voided_at: null },
      ]);
      dbh
        .prepare("INSERT INTO notification_runs (trigger, triggered_by_id, as_of_date, started_at) VALUES ('manual', 1, '2026-09-26', '2026-09-26T00:00:00Z')")
        .run();
      expect(all(dbh, "SELECT max(id) AS id FROM notification_runs")[0].id).toBe(3);
    });

    it("rebuilds deliveries: run_id, channel, contact snapshot, renamed status, sent_at", () => {
      const dbh = upgraded(seedLegacy);
      const rows = all(
        dbh,
        "SELECT salesman_id, recipient_kind, channel, address, status, customer_count, attempt, sent_at, message_body FROM notification_deliveries ORDER BY id",
      );
      expect(rows).toEqual([
        { salesman_id: 2, recipient_kind: "salesman", channel: "whatsapp", address: "628222", status: "sent", customer_count: 1, attempt: 1, sent_at: "2026-09-10T01:02:03Z", message_body: "" },
        { salesman_id: 3, recipient_kind: "salesman", channel: "whatsapp", address: "", status: "skipped_no_contact", customer_count: 1, attempt: 1, sent_at: null, message_body: "" },
        { salesman_id: 1, recipient_kind: "supervisor", channel: "whatsapp", address: "628111", status: "failed", customer_count: 2, attempt: 1, sent_at: null, message_body: "" },
      ]);
      expect(all(dbh, "SELECT run_id FROM notification_deliveries").every((r) => r.run_id === 1)).toBe(true);
    });

    it("keeps a notified customer pending, attached to its salesman's latest sent message", () => {
      const dbh = upgraded(seedLegacy);
      const items = all(dbh, "SELECT i.customer_id, d.salesman_id, i.last_order_date FROM notification_items i JOIN notification_deliveries d ON d.id = i.delivery_id");
      // Toko Stay (Andi, sent) is kept; Toko Moved's salesman only had a skipped delivery, so it becomes eligible again.
      expect(items).toEqual([{ customer_id: 1, salesman_id: 2, last_order_date: "2026-09-01" }]);
      const cols = all(dbh, "PRAGMA table_info(customers)").map((c) => c.name);
      expect(cols).not.toContain("notified");
      expect(cols).not.toContain("handled_on");
    });

    it("turns reason_logs into follow-ups that point at the reason lookup", () => {
      const dbh = upgraded(seedLegacy);
      expect(
        all(
          dbh,
          `SELECT f.customer_id, f.salesman_id, f.outcome, r.code, f.follow_up_date, f.created_at, f.notification_item_id
           FROM follow_ups f JOIN follow_up_reasons r ON r.id = f.reason_id ORDER BY f.id`,
        ),
      ).toEqual([
        { customer_id: 2, salesman_id: 3, outcome: "not_ordering", code: "2", follow_up_date: "2026-08-05", created_at: "2026-08-05T00:00:00Z", notification_item_id: null },
        { customer_id: 1, salesman_id: 2, outcome: "not_ordering", code: "3", follow_up_date: "2026-09-05", created_at: "2026-09-05T00:00:00Z", notification_item_id: null },
      ]);
      expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'reason_logs'")).toHaveLength(0);
    });

    it("seeds the reference data: the offered reasons (and the salesman's-own-words one) and a template per code and channel", () => {
      const dbh = upgraded(seedLegacy);
      expect(all(dbh, "SELECT code, label, deactivates_customer FROM follow_up_reasons ORDER BY sort_order")).toEqual([
        { code: "1", label: "Kalah Harga", deactivates_customer: 0 },
        { code: "2", label: "Stok Masih Ada", deactivates_customer: 0 },
        { code: "3", label: "Sudah Bangkrut", deactivates_customer: 1 },
        { code: "other", label: "Lainnya", deactivates_customer: 0 }, // 0009
      ]);
      // 0003 seeds version 1 of each; 0006 replaces the salesman WhatsApp text with version 2, 0009 with version 3.
      const templates = all(dbh, "SELECT code, channel, version, is_active FROM message_templates ORDER BY code, channel, version");
      expect(templates).toEqual([
        { code: "reminder_salesman", channel: "email", version: 1, is_active: 1 },
        { code: "reminder_salesman", channel: "whatsapp", version: 1, is_active: 0 },
        { code: "reminder_salesman", channel: "whatsapp", version: 2, is_active: 0 },
        { code: "reminder_salesman", channel: "whatsapp", version: 3, is_active: 1 },
        { code: "reminder_supervisor", channel: "email", version: 1, is_active: 1 },
        { code: "reminder_supervisor", channel: "whatsapp", version: 1, is_active: 1 },
      ]);
      expect(String(all(dbh, "SELECT body FROM message_templates WHERE code = 'reminder_salesman' AND channel = 'whatsapp' AND is_active = 1")[0].body)).toContain("{{daftar_customer}}");
    });

    it("marks the WAHA API key as a secret and stamps every setting", () => {
      const dbh = upgraded(seedLegacy);
      const rows = all(dbh, "SELECT key, is_secret, updated_at, updated_by_id FROM app_settings ORDER BY key");
      expect(rows.map((r) => [r.key, r.is_secret])).toEqual([["waha.api_key", 1], ["waha.base_url", 0]]);
      for (const r of rows) expect(r.updated_at).toMatch(ISO);
    });
  });

  it("is idempotent", () => {
    const dbh = upgraded(seedLegacy);
    expect(runMigrations(dbh)).toEqual([]);
    expect(all(dbh, "SELECT * FROM customers")).toHaveLength(4);
  });
});

describe("0006: the new reminder text", () => {
  const WHATSAPP = "code = 'reminder_salesman' AND channel = 'whatsapp'";
  /** A database that has everything up to 0005 (so 0006 is the next migration), before `edit` runs. */
  function beforeReminderV2(edit?: (dbh: Database.Database) => void) {
    const dbh = legacyDb();
    runMigrations(dbh, firstMigrations(6));
    expect(all(dbh, `SELECT version FROM message_templates WHERE ${WHATSAPP}`)).toEqual([{ version: 1 }]);
    edit?.(dbh);
    return dbh;
  }

  it("adds the new text as version 2, keeps version 1 (retired), and touches no other template", () => {
    const dbh = beforeReminderV2();
    const untouched = all(dbh, "SELECT * FROM message_templates WHERE NOT (" + WHATSAPP + ") ORDER BY id");

    expect(runMigrations(dbh, firstMigrations(7))).toEqual(["0006_reminder_message_v2"]);

    const versions = all(dbh, `SELECT version, is_active, body FROM message_templates WHERE ${WHATSAPP} ORDER BY version`);
    expect(versions.map((v) => [v.version, v.is_active])).toEqual([[1, 0], [2, 1]]);
    expect(String(versions[0].body)).toMatch(/^Halo \{\{nama\}\}/); // the old text is intact
    expect(versions[1].body).toBe(
      [
        "🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}",
        "",
        "Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:",
        "{{daftar_customer}}",
        "",
        "Balas dengan alasan: {{daftar_alasan}}.",
      ].join("\n"),
    );
    expect(all(dbh, "SELECT * FROM message_templates WHERE NOT (" + WHATSAPP + ") ORDER BY id")).toEqual(untouched);
  });

  it("leaves a text the admin already changed alone", () => {
    const dbh = beforeReminderV2((h) => {
      h.exec(`UPDATE message_templates SET is_active = 0 WHERE ${WHATSAPP}`);
      h.exec(
        `INSERT INTO message_templates (code, channel, recipient_kind, subject, body, version, is_active, created_at)
         VALUES ('reminder_salesman', 'whatsapp', 'salesman', '', 'Teks buatan admin', 2, 1, '2026-09-01T00:00:00Z')`,
      );
    });

    runMigrations(dbh);

    const versions = all(dbh, `SELECT version, is_active, body FROM message_templates WHERE ${WHATSAPP} ORDER BY version`);
    expect(versions).toEqual([
      { version: 1, is_active: 0, body: expect.stringMatching(/^Halo/) },
      { version: 2, is_active: 1, body: "Teks buatan admin" },
    ]);
  });
});

describe("0009: answering in the salesman's own words", () => {
  const WHATSAPP = "code = 'reminder_salesman' AND channel = 'whatsapp'";
  const TAIL = "0009_free_text_reason";
  /** A database with everything up to 0008, i.e. 0009 is next. `edit` runs before it. */
  function beforeFreeText(edit?: (dbh: Database.Database) => void) {
    const dbh = legacyDb();
    runMigrations(dbh, firstMigrations(9));
    edit?.(dbh);
    return dbh;
  }
  const versions = (dbh: Database.Database) =>
    all(dbh, `SELECT version, is_active, body FROM message_templates WHERE ${WHATSAPP} ORDER BY version`);

  it("adds the 'Lainnya' reason once, without touching the offered ones", () => {
    const dbh = beforeFreeText();
    const before = all(dbh, "SELECT * FROM follow_up_reasons WHERE code <> 'other' ORDER BY id");
    expect(all(dbh, "SELECT * FROM follow_up_reasons WHERE code = 'other'")).toHaveLength(0);

    expect(runMigrations(dbh)).toEqual([TAIL]);

    expect(all(dbh, "SELECT code, label, deactivates_customer, is_active FROM follow_up_reasons WHERE code = 'other'")).toEqual([
      { code: "other", label: "Lainnya", deactivates_customer: 0, is_active: 1 },
    ]);
    expect(all(dbh, "SELECT * FROM follow_up_reasons WHERE code <> 'other' ORDER BY id")).toEqual(before);
  });

  it("replaces the text 0006 shipped with the new one, keeping it as the previous version", () => {
    const dbh = beforeFreeText();
    expect(versions(dbh).map((v) => [v.version, v.is_active])).toEqual([[1, 0], [2, 1]]);

    runMigrations(dbh);

    const after = versions(dbh);
    expect(after.map((v) => [v.version, v.is_active])).toEqual([[1, 0], [2, 0], [3, 1]]);
    expect(String(after[1].body)).toMatch(/Balas dengan alasan: \{\{daftar_alasan\}\}\.$/); // 0006's text, intact
    expect(after[2].body).toBe(
      [
        "🔔 Reminder Customer Anda [{{nama}}] — {{tanggal}}",
        "",
        "Ada {{jumlah}} customer yang sudah melewati siklus order normalnya:",
        "{{daftar_customer}}",
        "",
        "*Cara membalas:* tekan Balas (reply) pada pesan ini, lalu tulis:",
        "• Satu/beberapa customer: nomor + alasan",
        "  contoh: 3 Kalah Harga  atau  1,2,5 Stok Masih Ada",
        "• Semua customer: alasannya saja",
        "  contoh: Stok Masih Ada",
        "Pilihan alasan: {{daftar_alasan}}. Boleh juga menulis alasan Anda sendiri.",
      ].join("\n"),
    );
  });

  it("also replaces the original text when 0006 was recorded as applied but never ran (a database that had its empty stub)", () => {
    const dbh = legacyDb();
    runMigrations(dbh, firstMigrations(6)); // through 0005
    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
    const at = (tag: string) => journal.entries.find((e) => e.tag === tag)!.when;
    dbh.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run("empty-stub", at("0006_reminder_message_v2"));
    expect(versions(dbh).map((v) => [v.version, v.is_active])).toEqual([[1, 1]]); // still the original

    expect(runMigrations(dbh)).toEqual(["0007_inbound_replies", "0008_inbound_reply_to", TAIL]);

    expect(versions(dbh).map((v) => [v.version, v.is_active])).toEqual([[1, 0], [2, 1]]);
    expect(String(versions(dbh)[1].body)).toContain("Cara membalas");
  });

  it("leaves a text the admin already wrote alone — and still adds the reason", () => {
    const dbh = beforeFreeText((h) => {
      h.exec(`UPDATE message_templates SET is_active = 0 WHERE ${WHATSAPP}`);
      h.exec(
        `INSERT INTO message_templates (code, channel, recipient_kind, subject, body, version, is_active, created_at)
         VALUES ('reminder_salesman', 'whatsapp', 'salesman', '', 'Teks buatan admin', 3, 1, '2026-09-01T00:00:00Z')`,
      );
    });

    runMigrations(dbh);

    expect(versions(dbh).map((v) => [v.version, v.is_active, v.body === "Teks buatan admin" ? "admin" : ""]).filter((v) => v[1] === 1)).toEqual([[3, 1, "admin"]]);
    expect(versions(dbh)).toHaveLength(3); // no fourth version
    expect(all(dbh, "SELECT code FROM follow_up_reasons WHERE code = 'other'")).toHaveLength(1);
  });

  it("does not touch the supervisor text or the email texts", () => {
    const dbh = beforeFreeText();
    const untouched = all(dbh, "SELECT * FROM message_templates WHERE NOT (" + WHATSAPP + " ) ORDER BY id");
    runMigrations(dbh);
    expect(all(dbh, "SELECT * FROM message_templates WHERE NOT (" + WHATSAPP + " ) ORDER BY id")).toEqual(untouched);
  });
});

describe("failure handling", () => {
  it("refuses, before touching anything, when names clash only by case", () => {
    const dbh = legacyDb();
    dbh.exec(`
      INSERT INTO salesmen (id, nama) VALUES (1, 'Andi');
      INSERT INTO customers (nama, salesman_id, tipe_customer) VALUES ('Toko Maju', 1, 'lama'), ('toko maju', 1, 'lama');
    `);
    expect(() => runMigrations(dbh)).toThrow(/beda huruf besar\/kecil.*"toko maju"/s);
    // Nothing changed: the legacy tables are all still there, unmigrated.
    expect(all(dbh, "SELECT * FROM customers")).toHaveLength(2);
    expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'mutation_logs'")).toHaveLength(1);
    expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'customer_assignments'")).toHaveLength(0);
  });

  it("rolls a migration back completely, and does not record it, when a statement fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigula-mig-"));
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(path.join(dir, "0000_ok.sql"), "CREATE TABLE ok (id INTEGER);");
    fs.writeFileSync(
      path.join(dir, "0001_bad.sql"),
      "CREATE TABLE half (id INTEGER);--> statement-breakpoint\nINSERT INTO nowhere VALUES (1);",
    );
    fs.writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({
        entries: [
          { idx: 0, when: 1000, tag: "0000_ok" },
          { idx: 1, when: 2000, tag: "0001_bad" },
        ],
      }),
    );
    const dbh = new Database(":memory:");
    expect(() => runMigrations(dbh, dir)).toThrow(/0001_bad failed and was rolled back/);
    expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'half'")).toHaveLength(0);
    expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'ok'")).toHaveLength(1);
    expect(all(dbh, "SELECT created_at FROM __drizzle_migrations")).toEqual([{ created_at: 1000 }]);
  });

  it("rolls back when a migration leaves a dangling foreign key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigula-mig-"));
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(
      path.join(dir, "0000_orphan.sql"),
      "CREATE TABLE p (id INTEGER PRIMARY KEY);--> statement-breakpoint\n" +
        "CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id));--> statement-breakpoint\n" +
        "INSERT INTO c (p_id) VALUES (99);",
    );
    fs.writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ idx: 0, when: 1000, tag: "0000_orphan" }] }),
    );
    const dbh = new Database(":memory:");
    expect(() => runMigrations(dbh, dir)).toThrow(/foreign key violation/);
    expect(all(dbh, "SELECT name FROM sqlite_master WHERE name = 'c'")).toHaveLength(0);
  });
});
