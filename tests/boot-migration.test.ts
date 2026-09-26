import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLegacyBaseline } from "~/db/migrate.server";
import { runMigrations } from "~/db/migrations.server";

import { firstMigrations } from "./helpers/migrations";

const columns = (dbh: Database.Database, table: string) =>
  (dbh.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/** How many migrations the project has: every one of them must be applied after opening. */
const migrationCount = (
  JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }
).entries.length;

describe("the schema is current as soon as the database is opened", () => {
  const original = process.env.DATABASE_PATH;
  afterEach(() => {
    process.env.DATABASE_PATH = original;
    vi.resetModules();
  });

  it("a database left at an older schema is brought up to date before any query runs", async () => {
    // What a developer's database looks like after an older build: three migrations applied, two not.
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sigula-old-")), "old.db");
    const old = new Database(dbPath);
    applyLegacyBaseline(old);
    runMigrations(old, firstMigrations(3));
    expect(columns(old, "users")).not.toContain("salesman_id");
    old.close();

    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();
    const { sqlite, db } = await import("~/db/client.server");
    const { users } = await import("~/db/schema");

    // No loader, no seed call: merely having opened the database is enough — the very first query works.
    expect(columns(sqlite, "users")).toContain("salesman_id");
    expect(() => db.select({ id: users.id, salesmanId: users.salesmanId }).from(users).all()).not.toThrow();
    expect(sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: migrationCount });
    sqlite.close();
  });

  it("a brand-new database file is created fully migrated", async () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sigula-new-")), "new.db");
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();
    const { sqlite } = await import("~/db/client.server");
    expect(columns(sqlite, "users")).toContain("is_active");
    expect(sqlite.prepare("SELECT count(*) AS n FROM roles").get()).toEqual({ n: 4 });
    sqlite.close();
  });

  it("a migration that fails stops the open with its own message instead of leaving a half-migrated schema", async () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sigula-dupe-")), "dupe.db");
    const old = new Database(dbPath);
    applyLegacyBaseline(old);
    old.exec(`
      INSERT INTO salesmen (id, nama) VALUES (1, 'Andi');
      INSERT INTO customers (nama, salesman_id, tipe_customer) VALUES ('Toko Maju', 1, 'lama'), ('toko maju', 1, 'lama');
    `);
    old.close();

    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();
    await expect(import("~/db/client.server")).rejects.toThrow(/beda huruf besar\/kecil/);
  });
});
