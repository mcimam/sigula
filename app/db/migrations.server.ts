import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Database } from "better-sqlite3";

/**
 * Applies the SQL files drizzle-kit generated into `drizzle/` (ADR-0005).
 * drizzle-kit only *writes* migrations (`npm run db:generate`); this runs them,
 * because drizzle's own SQLite migrator wraps everything in a transaction, where
 * `PRAGMA foreign_keys = OFF` is a no-op — so a table rebuild (create new, copy,
 * drop old, rename) would trip the foreign keys of every child table.
 *
 * Per migration: foreign keys off (must be set *outside* the transaction), one
 * transaction, `foreign_key_check` before commit, rollback on any failure. The
 * bookkeeping table is drizzle's own (`__drizzle_migrations`), so drizzle tooling
 * still understands the history.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

type JournalEntry = { idx: number; when: number; tag: string };

/**
 * Checks that would otherwise surface as an opaque constraint error halfway
 * through a migration. They run before the migration's transaction opens and
 * throw an actionable message; nothing has been touched when they do.
 */
const PREFLIGHT: Record<string, (dbh: Database) => void> = {
  "0001_erd_v2_foundation": assertNoCaseInsensitiveCustomerDuplicates,
};

function assertNoCaseInsensitiveCustomerDuplicates(dbh: Database) {
  const dupes = dbh
    .prepare(
      `SELECT lower(nama) AS nama, salesman_id, count(*) AS n, group_concat(id) AS ids
       FROM customers GROUP BY lower(nama), salesman_id HAVING count(*) > 1`,
    )
    .all() as { nama: string; salesman_id: number; n: number; ids: string }[];
  if (dupes.length === 0) return;
  const list = dupes
    .map((d) => `"${d.nama}" milik salesman #${d.salesman_id} (customer id ${d.ids})`)
    .join("; ");
  throw new Error(
    `Migrasi 0001 dibatalkan: ada customer yang namanya hanya beda huruf besar/kecil dalam ` +
      `satu salesman — ${list}. Gabungkan atau ubah nama salah satunya, lalu jalankan ulang. ` +
      `Database belum diubah.`,
  );
}

function readJournal(dir: string): JournalEntry[] {
  const file = path.join(dir, "meta", "_journal.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { entries: JournalEntry[] }).entries;
}

/** True once at least one migration has been recorded. */
export function hasAppliedMigrations(dbh: Database): boolean {
  const table = dbh
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return false;
  return dbh.prepare("SELECT 1 FROM __drizzle_migrations LIMIT 1").get() !== undefined;
}

function applyOne(dbh: Database, dir: string, entry: JournalEntry) {
  const source = fs.readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  PREFLIGHT[entry.tag]?.(dbh);

  dbh.pragma("foreign_keys = OFF");
  try {
    dbh.exec("BEGIN");
    try {
      for (const statement of statements) dbh.exec(statement);
      const violations = dbh.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`${violations.length} foreign key violation(s) after the migration`);
      }
      dbh.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(
        crypto.createHash("sha256").update(source).digest("hex"),
        entry.when,
      );
      dbh.exec("COMMIT");
    } catch (err) {
      dbh.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Migration ${entry.tag} failed and was rolled back: ${reason}`, {
      cause: err,
    });
  } finally {
    dbh.pragma("foreign_keys = ON");
  }
}

/** Applies every migration newer than the last recorded one, in journal order. */
export function runMigrations(dbh: Database, dir: string = MIGRATIONS_DIR) {
  dbh.exec(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  const last = dbh
    .prepare('SELECT max("created_at") AS at FROM "__drizzle_migrations"')
    .get() as { at: number | null };
  const applied = last.at ?? -1;
  const pending = readJournal(dir)
    .filter((e) => e.when > applied)
    .sort((a, b) => a.when - b.when);
  for (const entry of pending) applyOne(dbh, dir, entry);
  return pending.map((e) => e.tag);
}
