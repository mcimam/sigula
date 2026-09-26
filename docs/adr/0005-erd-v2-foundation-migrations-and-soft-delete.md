# ADR-0005 — ERD v2 foundation: versioned migrations, soft delete, append-only history

| | |
|---|---|
| Status | accepted (release R1 implemented on branch `feat/erd-v2-foundation`; not deployed) |
| Date | 2026-09-26 |
| Deciders | User (choices made in chat: SQLite now / PostgreSQL later, single company, transactions stay simple, soft delete with restore, drizzle-kit, salesman self-reference kept) |
| Design | `docs/erd-sigula.dbml` |

## Context

The pilot schema was created by raw `CREATE TABLE IF NOT EXISTS` in
`migrate.server.ts`, which never alters an existing table, so every change needed
a hand-rolled one-off upgrade (`migrateLegacySupervisors`). Review of the ERD found
data-loss and consistency problems that all came from the same places: hard deletes
that either failed on a foreign key or removed history (`ON DELETE NO ACTION` on log
tables; customer delete cascaded to its history), a customer's holder stored only as
"current + a log", timestamps in three formats (and a date default in UTC while the
app used the machine's local date), and no way to tell where an imported order came from.
The goal is a model that can grow (PostgreSQL later, more channels, RBAC) without
rewriting history.

## Decision

1. **Versioned migrations.** `schema.ts` is the source of truth; `drizzle-kit generate`
   writes `drizzle/NNNN_*.sql` and snapshots. Migrations are applied by our own runner
   (`app/db/migrations.server.ts`), not drizzle's: drizzle's SQLite migrator wraps
   everything in a transaction, where `PRAGMA foreign_keys = OFF` is a no-op, so a table
   rebuild trips the foreign keys of every child table. Ours turns foreign keys off
   *outside* a per-migration transaction, runs `foreign_key_check` before commit, rolls
   back on any failure and keeps drizzle's `__drizzle_migrations` table. The ADR-0004
   DDL is frozen as the baseline and only runs on a database that has never recorded a
   migration.
   **Migrations run when the database is opened** (`client.server.ts` → `migrateDatabase`), not from a
   route: a first request can skip the root loader (a client-side navigation after a server restart), and a route
   trigger then queries the old schema. A failing migration throws at start-up, so the server never serves on a
   half-migrated schema; `tests/boot-migration.test.ts` reproduces the failure this prevents.
2. **Conventions.** Enums are `TEXT` + `CHECK` (portable, no DB enum type). Timestamps are
   ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ`, filled by the application, never by a DB default.
   Business dates use the Asia/Jakarta calendar (`todayIso`), not the server's.
3. **Soft delete for master data and transaksi** (`deleted_at`). Everything reads through
   `alive()`. Uniqueness (`username`, `lower(customers.nama)` per salesman) applies to live
   rows only (partial unique indexes). A restore refuses, with a message, when it would leave
   a live row pointing at a deleted one or reuse a taken name. Deleting a customer also
   soft-deletes its live transaksi, marked with `transaksi.deleted_with_customer_id`
   so a restore brings back exactly those (matching on the timestamp alone conflated
   two deletions in the same second — found by a test). Admins get a "Terhapus" view with
   **Pulihkan** on Transaksi and the three Data Master tabs.
4. **Append-only history.** `customer_assignments` (who held a customer, `valid_from`/`valid_to`)
   replaces `mutation_logs`; `customer_status_history` (from/to/reason) replaces `status_logs`.
   `customers.salesman_id` and `status_customer` stay as the current-state cache, written in the
   same transaction. `import_batches` records each Excel import (`file_name`, sha-256) and links the
   transaksi it wrote. `transaksi` gains `created/updated/deleted_by`.
5. **Customer names are unique per salesman ignoring case.** Import matches the same way.

## Consequences

- **Migration 0001 refuses to run** if two live customers of one salesman differ only by case
  (it names them; nothing is changed). This must be checked before a production deploy.
- Legacy rows have no real creation time: `created_at` is the migration moment, or the earliest
  known event for a customer. AUTOINCREMENT counters are carried across rebuilds so a deleted id is
  never reused (audit rows still point at them).
- A move log that disagrees with `customers.salesman_id` (edited by hand) is resolved in favour of the
  customer row, with a visible note in the assignment.
- `deleteSalesman` no longer deletes `profiles`; a user whose salesman is deleted simply cannot sign in.
- Deleted rows are never purged (DEBT-013). Notification batches were still hard-deletable until R3
  (ADR-0006).
- `drizzle-kit` cannot express an expression index on SQLite and renders `ADD COLUMN … NOT NULL` without a
  default; `0001` is therefore hand-written and the `lower(nama)` index is guarded by a behavioural test.
- Rollback is a file restore of the SQLite volume (runbook); migrations are not reversible.

## Alternatives rejected

- **drizzle's own migrator** — see decision 1.
- **Hard delete with `ON DELETE SET NULL` + name snapshots** — loses the ability to undo and leaves history
  pointing at nothing.
- **Keeping `mutation_logs`** — cannot answer "who held customer X on date Y".
- **A `code`/ERP column, `is_active`/`last_login_at` on users** — no consumer yet; additive later.

## Verification

`tests/migrations.test.ts` (schema drift against `schema.ts` for every table; a legacy database with data
upgraded; rollback on a failing statement and on a dangling foreign key; the duplicate-name preflight; counters),
`tests/trash.test.ts`, plus the full suite; migration 0001 also ran unchanged against the real development
database. Deliberately breaking the migration and the schema made the tests fail.
