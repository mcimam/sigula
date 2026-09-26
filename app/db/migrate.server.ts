import type { Database } from "better-sqlite3";

import { sqlite } from "./client.server";

const SALESMEN_DDL = (name: string) => `
  CREATE TABLE ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    nomor_wa TEXT NOT NULL DEFAULT '',
    supervisor_id INTEGER REFERENCES salesmen(id),
    status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'inactive')),
    CHECK (supervisor_id IS NULL OR supervisor_id <> id)
  )`;

const PROFILES_DDL = (name: string) => `
  CREATE TABLE ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'salesman', 'management')),
    salesman_id INTEGER REFERENCES salesmen(id),
    CHECK (
      (role IN ('salesman', 'supervisor') AND salesman_id IS NOT NULL)
      OR (role IN ('admin', 'management') AND salesman_id IS NULL)
    )
  )`;

const DELIVERIES_DDL = (name: string) => `
  CREATE TABLE ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES notification_batches(id),
    salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
    recipient_kind TEXT NOT NULL DEFAULT 'salesman' CHECK (recipient_kind IN ('salesman', 'supervisor')),
    customer_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_phone')),
    error_message TEXT NOT NULL DEFAULT ''
  )`;

/** Idempotent schema bootstrap for the pilot SQLite DB. */
export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    ${SALESMEN_DDL("IF NOT EXISTS salesmen")};

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      tipe_customer TEXT NOT NULL CHECK (tipe_customer IN ('lama', 'baru')),
      order_cycle_days INTEGER NOT NULL DEFAULT 30 CHECK (order_cycle_days >= 1),
      status_customer TEXT NOT NULL DEFAULT 'aktif' CHECK (status_customer IN ('aktif', 'inactive')),
      last_order_date TEXT,
      notified INTEGER NOT NULL DEFAULT 0,
      handled_on TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_name_per_salesman
      ON customers(nama, salesman_id);

    ${PROFILES_DDL("IF NOT EXISTS profiles")};

    CREATE TABLE IF NOT EXISTS transaksi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      tanggal_order TEXT NOT NULL,
      sumber TEXT NOT NULL CHECK (sumber IN ('seed', 'import', 'manual')),
      tanggal_input TEXT NOT NULL DEFAULT (date('now')),
      catatan TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reason_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      tanggal TEXT NOT NULL DEFAULT (date('now')),
      kode_alasan TEXT NOT NULL CHECK (kode_alasan IN ('1', '2', '3'))
    );

    CREATE TABLE IF NOT EXISTS notification_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL DEFAULT (datetime('now')),
      triggered_by_id INTEGER NOT NULL REFERENCES users(id)
    );

    ${DELIVERIES_DDL("IF NOT EXISTS notification_deliveries")};

    CREATE TABLE IF NOT EXISTS mutation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      dari_salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      ke_salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      tanggal TEXT NOT NULL DEFAULT (datetime('now')),
      oleh_id INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      tipe TEXT NOT NULL CHECK (tipe IN ('manual_inactive', 'manual_reactivation', 'auto_reactivation')),
      tanggal TEXT NOT NULL DEFAULT (datetime('now')),
      oleh_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('transaksi', 'customer', 'salesman', 'user')),
      entity_id INTEGER NOT NULL,
      entity_label TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL DEFAULT '',
      changes TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_entity_idx
      ON activity_logs(entity_type, entity_id, id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // One-time lift from legacy order_history → transaksi (pilot DBs).
  const legacy = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='order_history'",
    )
    .get() as { name: string } | undefined;
  if (legacy) {
    sqlite.exec(`
      INSERT INTO transaksi (customer_id, salesman_id, tanggal_order, sumber, tanggal_input, catatan)
      SELECT oh.customer_id, c.salesman_id, oh.tanggal_order, oh.sumber, oh.tanggal_input, ''
      FROM order_history oh
      JOIN customers c ON c.id = oh.customer_id
      WHERE NOT EXISTS (
        SELECT 1 FROM transaksi t
        WHERE t.customer_id = oh.customer_id
          AND t.tanggal_order = oh.tanggal_order
          AND t.sumber = oh.sumber
      );
      DROP TABLE order_history;
    `);
  }

  migrateLegacySupervisors(sqlite);
}

/**
 * ADR-0004 — fold the legacy `supervisors` table into `salesmen`.
 *
 * Each supervisor becomes a salesman row (same name/WA), their subordinates'
 * `supervisor_id` is re-pointed at it, supervisor-role profiles link to it via
 * `salesman_id`, and supervisor deliveries become `recipient_kind='supervisor'`.
 * SQLite can't alter FKs/CHECKs in place, so `salesmen`, `profiles` and
 * `notification_deliveries` are rebuilt. Runs in one transaction, verifies
 * `foreign_key_check` before committing, and is a no-op once `supervisors`
 * is gone (so it is idempotent across boots).
 */
export function migrateLegacySupervisors(dbh: Database) {
  const hasLegacy = dbh
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supervisors'")
    .get();
  if (!hasLegacy) return { migrated: false, supervisorsConverted: 0 };

  dbh.pragma("foreign_keys = OFF");
  try {
    let converted = 0;
    dbh.transaction(() => {
      const supRows = dbh
        .prepare("SELECT id, nama, nomor_wa FROM supervisors ORDER BY id")
        .all() as { id: number; nama: string; nomor_wa: string }[];

      dbh.exec(SALESMEN_DDL("salesmen_new"));
      dbh.exec(`
        INSERT INTO salesmen_new (id, nama, nomor_wa, supervisor_id, status)
        SELECT id, nama, nomor_wa, NULL, status FROM salesmen
      `);

      const oldToNew = new Map<number, number>();
      const insertSup = dbh.prepare(
        "INSERT INTO salesmen_new (nama, nomor_wa, supervisor_id, status) VALUES (?, ?, NULL, 'aktif')",
      );
      for (const sup of supRows) {
        oldToNew.set(sup.id, Number(insertSup.run(sup.nama, sup.nomor_wa).lastInsertRowid));
      }
      converted = supRows.length;

      const setParent = dbh.prepare("UPDATE salesmen_new SET supervisor_id = ? WHERE id = ?");
      const children = dbh
        .prepare("SELECT id, supervisor_id FROM salesmen WHERE supervisor_id IS NOT NULL")
        .all() as { id: number; supervisor_id: number }[];
      for (const child of children) {
        setParent.run(oldToNew.get(child.supervisor_id) ?? null, child.id);
      }

      dbh.exec("CREATE TEMP TABLE _sup_map (old_id INTEGER PRIMARY KEY, new_id INTEGER NOT NULL)");
      const insertMap = dbh.prepare("INSERT INTO _sup_map (old_id, new_id) VALUES (?, ?)");
      for (const [oldId, newId] of oldToNew) insertMap.run(oldId, newId);

      dbh.exec(PROFILES_DDL("profiles_new"));
      dbh.exec(`
        INSERT INTO profiles_new (id, user_id, role, salesman_id)
        SELECT id, user_id, role,
          CASE WHEN role = 'supervisor'
            THEN (SELECT new_id FROM _sup_map WHERE old_id = profiles.supervisor_id)
            ELSE salesman_id END
        FROM profiles
      `);

      dbh.exec(DELIVERIES_DDL("notification_deliveries_new"));
      dbh.exec(`
        INSERT INTO notification_deliveries_new
          (id, batch_id, salesman_id, recipient_kind, customer_count, status, error_message)
        SELECT id, batch_id,
          COALESCE(salesman_id, (SELECT new_id FROM _sup_map WHERE old_id = notification_deliveries.supervisor_id)),
          CASE WHEN salesman_id IS NOT NULL THEN 'salesman' ELSE 'supervisor' END,
          customer_count, status, error_message
        FROM notification_deliveries
      `);

      dbh.exec(`
        DROP TABLE profiles;
        DROP TABLE notification_deliveries;
        DROP TABLE salesmen;
        DROP TABLE supervisors;
        DROP TABLE _sup_map;
        ALTER TABLE salesmen_new RENAME TO salesmen;
        ALTER TABLE profiles_new RENAME TO profiles;
        ALTER TABLE notification_deliveries_new RENAME TO notification_deliveries;
      `);

      const violations = dbh.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Supervisor→salesman migration aborted: ${violations.length} foreign key violation(s)`,
        );
      }
    })();
    return { migrated: true, supervisorsConverted: converted };
  } finally {
    dbh.pragma("foreign_keys = ON");
  }
}
