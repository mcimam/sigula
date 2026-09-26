import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { migrateLegacySupervisors } from "~/db/migrate.server";

/** The pre-ADR-0004 schema, verbatim in the parts the migration touches. */
const LEGACY_DDL = `
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL);
  CREATE TABLE supervisors (id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL,
    nomor_wa TEXT NOT NULL DEFAULT '');
  CREATE TABLE salesmen (id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL,
    nomor_wa TEXT NOT NULL DEFAULT '', supervisor_id INTEGER REFERENCES supervisors(id),
    status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'inactive')));
  CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL,
    salesman_id INTEGER NOT NULL REFERENCES salesmen(id));
  CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'salesman', 'management')),
    salesman_id INTEGER REFERENCES salesmen(id),
    supervisor_id INTEGER REFERENCES supervisors(id),
    CHECK (
      (role = 'salesman' AND salesman_id IS NOT NULL AND supervisor_id IS NULL)
      OR (role = 'supervisor' AND supervisor_id IS NOT NULL AND salesman_id IS NULL)
      OR (role IN ('admin', 'management') AND salesman_id IS NULL AND supervisor_id IS NULL)));
  CREATE TABLE notification_batches (id INTEGER PRIMARY KEY AUTOINCREMENT,
    tanggal TEXT NOT NULL DEFAULT (datetime('now')),
    triggered_by_id INTEGER NOT NULL REFERENCES users(id));
  CREATE TABLE notification_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES notification_batches(id),
    salesman_id INTEGER REFERENCES salesmen(id),
    supervisor_id INTEGER REFERENCES supervisors(id),
    customer_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_phone')),
    error_message TEXT NOT NULL DEFAULT '',
    CHECK ((salesman_id IS NOT NULL AND supervisor_id IS NULL)
      OR (salesman_id IS NULL AND supervisor_id IS NOT NULL)));
`;

function legacyDb(opts: { danglingSupervisorProfile?: boolean } = {}) {
  const dbh = new Database(":memory:");
  dbh.exec(LEGACY_DDL);
  // A dangling FK can only exist if it was written with enforcement off.
  if (opts.danglingSupervisorProfile) dbh.pragma("foreign_keys = OFF");
  dbh.exec(`
    INSERT INTO users (id, username, password_hash, display_name) VALUES
      (1, 'admin', 'h', 'Admin'), (2, 'sal', 'h', 'Sal'), (3, 'sup', 'h', 'Sup');
    INSERT INTO supervisors (id, nama, nomor_wa) VALUES (1, 'Budi', '6281'), (2, 'Sari', '6282');
    INSERT INTO salesmen (id, nama, nomor_wa, supervisor_id, status) VALUES
      (1, 'Andi', '6291', 1, 'aktif'), (2, 'Citra', '6292', 1, 'inactive'),
      (3, 'Dewi', '6293', 2, 'aktif'), (4, 'Eko', '6294', NULL, 'aktif');
    INSERT INTO customers (id, nama, salesman_id) VALUES (1, 'Toko A', 1), (2, 'Toko B', 3);
    INSERT INTO profiles (user_id, role, salesman_id, supervisor_id) VALUES
      (1, 'admin', NULL, NULL), (2, 'salesman', 1, NULL),
      (3, 'supervisor', NULL, ${opts.danglingSupervisorProfile ? 999 : 2});
    INSERT INTO notification_batches (id, triggered_by_id) VALUES (1, 1);
    INSERT INTO notification_deliveries (batch_id, salesman_id, supervisor_id, customer_count, status)
      VALUES (1, 1, NULL, 2, 'sent'), (1, NULL, 1, 2, 'failed');
  `);
  dbh.pragma("foreign_keys = ON");
  return dbh;
}

const tables = (dbh: Database.Database) =>
  (dbh.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (t) => t.name,
  );

describe("legacy supervisors → salesmen migration (ADR-0004)", () => {
  it("turns each supervisor into a salesman and re-links everything that pointed at it", () => {
    const dbh = legacyDb();
    const result = migrateLegacySupervisors(dbh);

    expect(result).toEqual({ migrated: true, supervisorsConverted: 2 });
    expect(tables(dbh)).not.toContain("supervisors");

    const sm = dbh.prepare("SELECT * FROM salesmen ORDER BY id").all() as any[];
    expect(sm.map((s) => s.nama)).toEqual(["Andi", "Citra", "Dewi", "Eko", "Budi", "Sari"]);
    const budi = sm.find((s) => s.nama === "Budi");
    const sari = sm.find((s) => s.nama === "Sari");
    expect([budi.nomor_wa, sari.nomor_wa]).toEqual(["6281", "6282"]);
    // Existing salesman ids are preserved (customers/transaksi reference them).
    expect(sm.slice(0, 4).map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(sm.find((s) => s.nama === "Andi").supervisor_id).toBe(budi.id);
    expect(sm.find((s) => s.nama === "Citra").supervisor_id).toBe(budi.id);
    expect(sm.find((s) => s.nama === "Dewi").supervisor_id).toBe(sari.id);
    expect(sm.find((s) => s.nama === "Eko").supervisor_id).toBeNull();
    expect(sm.find((s) => s.nama === "Citra").status).toBe("inactive");

    const profiles = dbh.prepare("SELECT role, salesman_id FROM profiles ORDER BY user_id").all();
    expect(profiles).toEqual([
      { role: "admin", salesman_id: null },
      { role: "salesman", salesman_id: 1 },
      { role: "supervisor", salesman_id: sari.id },
    ]);

    const deliveries = dbh
      .prepare("SELECT salesman_id, recipient_kind, status FROM notification_deliveries ORDER BY id")
      .all();
    expect(deliveries).toEqual([
      { salesman_id: 1, recipient_kind: "salesman", status: "sent" },
      { salesman_id: budi.id, recipient_kind: "supervisor", status: "failed" },
    ]);

    expect(dbh.prepare("SELECT COUNT(*) AS n FROM customers").get()).toEqual({ n: 2 });
    expect(dbh.pragma("foreign_key_check")).toEqual([]);
  });

  it("leaves the DB with the new constraints and keeps AUTOINCREMENT going", () => {
    const dbh = legacyDb();
    migrateLegacySupervisors(dbh);
    dbh.pragma("foreign_keys = ON");

    // no self-supervision
    expect(() =>
      dbh.prepare("UPDATE salesmen SET supervisor_id = id WHERE id = 1").run(),
    ).toThrow();
    // supervisor role now needs a salesman link
    expect(() =>
      dbh
        .prepare("INSERT INTO profiles (user_id, role, salesman_id) VALUES (99, 'supervisor', NULL)")
        .run(),
    ).toThrow();
    // ids continue after the converted supervisors (5, 6)
    const next = dbh.prepare("INSERT INTO salesmen (nama) VALUES ('Baru')").run();
    expect(Number(next.lastInsertRowid)).toBe(7);
    // the FK on the rebuilt table really points at itself
    expect(() =>
      dbh.prepare("UPDATE salesmen SET supervisor_id = 12345 WHERE id = 1").run(),
    ).toThrow();
  });

  it("is a no-op once supervisors is gone (idempotent across boots)", () => {
    const dbh = legacyDb();
    migrateLegacySupervisors(dbh);
    const before = dbh.prepare("SELECT * FROM salesmen ORDER BY id").all();
    expect(migrateLegacySupervisors(dbh)).toEqual({ migrated: false, supervisorsConverted: 0 });
    expect(dbh.prepare("SELECT * FROM salesmen ORDER BY id").all()).toEqual(before);
  });

  it("rolls back completely if the data can't satisfy the new constraints", () => {
    const dbh = legacyDb({ danglingSupervisorProfile: true });

    expect(() => migrateLegacySupervisors(dbh)).toThrow();

    expect(tables(dbh)).toContain("supervisors");
    expect(tables(dbh)).not.toContain("salesmen_new");
    expect(dbh.prepare("SELECT COUNT(*) AS n FROM salesmen").get()).toEqual({ n: 4 });
    expect(dbh.pragma("foreign_keys", { simple: true })).toBe(1); // restored
  });
});
