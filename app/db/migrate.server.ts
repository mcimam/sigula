import { sqlite } from "./client.server";

/** Idempotent schema bootstrap for the pilot SQLite DB. */
export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supervisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nomor_wa TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS salesmen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nomor_wa TEXT NOT NULL DEFAULT '',
      supervisor_id INTEGER REFERENCES supervisors(id),
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'inactive'))
    );

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

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'salesman', 'management')),
      salesman_id INTEGER REFERENCES salesmen(id),
      supervisor_id INTEGER REFERENCES supervisors(id),
      CHECK (
        (role = 'salesman' AND salesman_id IS NOT NULL AND supervisor_id IS NULL)
        OR (role = 'supervisor' AND supervisor_id IS NOT NULL AND salesman_id IS NULL)
        OR (role IN ('admin', 'management') AND salesman_id IS NULL AND supervisor_id IS NULL)
      )
    );

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

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES notification_batches(id),
      salesman_id INTEGER REFERENCES salesmen(id),
      supervisor_id INTEGER REFERENCES supervisors(id),
      customer_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_phone')),
      error_message TEXT NOT NULL DEFAULT '',
      CHECK (
        (salesman_id IS NOT NULL AND supervisor_id IS NULL)
        OR (salesman_id IS NULL AND supervisor_id IS NOT NULL)
      )
    );

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
}
