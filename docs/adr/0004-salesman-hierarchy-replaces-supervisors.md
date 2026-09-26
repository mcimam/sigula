# ADR-0004 — Salesman hierarchy (salesman 1—N salesman) replaces the Supervisor entity

| | |
|---|---|
| Status | accepted |
| Date | 2026-09-26 |
| Deciders | User (explicit request; scope questions answered in chat: drop the table, keep the role, free multi-level) |

## Context

The pilot modelled a **Supervisor** as its own entity (`supervisors`: name +
WhatsApp number) with `salesmen.supervisor_id → supervisors.id`. The user
asked to change "the supervisor relation on salesman" into
**salesman 1—N salesman**: the people who lead a team are themselves
salesmen, not a separate kind of record.

Three questions had more than one defensible answer, so they were put to the
user; the answers are the decisions below.

## Decision

1. **Drop the `supervisors` table.** `salesmen.supervisor_id` becomes a
   nullable self-reference to `salesmen.id` (name kept to limit churn; read it
   as "atasan"). A supervisor is simply a salesman who has subordinates.
2. **Keep the `supervisor` role.** A supervisor-role user is linked to a
   salesman through the existing `profiles.salesman_id` (the team's leading
   salesman). `profiles.supervisor_id` is removed; the role/link CHECK becomes
   "salesman *or* supervisor ⇒ `salesman_id` set; admin/management ⇒ null".
3. **Free multi-level hierarchy.** A subordinate may itself have subordinates.
   Enforced invariants: no salesman is their own supervisor (DB `CHECK` and
   app check); no cycles (app check in `assertValidSupervisor`, which the
   salesman drawer also mirrors by not offering the salesman or their own
   subordinates as supervisor candidates); a salesman with subordinates cannot
   be deleted until they are moved or deleted in the same batch.

### Scope of "team"

Multi-level makes "team" ambiguous, so it is defined per use:

| Use | Scope | Why |
|---|---|---|
| Supervisor dashboard, drill-down, reactivate, team export | **Whole subtree** (every subordinate at any depth, excluding the supervisor) | Oversight of everyone below you |
| WhatsApp summary ("Ringkasan tim …") | **Direct reports only, to the direct supervisor only** | The person directly responsible acts on it; no duplicate messages up the chain |
| Management "per supervisor" table and the "Per Supervisor" Excel sheet | **Direct reports only** | A partition: every salesman appears under exactly one supervisor, so totals never double count |

A supervisor who also has their own overdue customers receives **two
separate messages** (their own list, and the team summary) — recorded as two
deliveries distinguished by `notification_deliveries.recipient_kind`.

## Data model changes

- `salesmen.supervisor_id` → `REFERENCES salesmen(id)`, `CHECK (supervisor_id IS NULL OR supervisor_id <> id)`.
- `profiles`: drop `supervisor_id`; new role/link CHECK (above).
- `notification_deliveries`: `salesman_id` is now `NOT NULL`; `supervisor_id`
  removed; new `recipient_kind ('salesman' | 'supervisor')` says which message
  that recipient got. The old "exactly one of salesman/supervisor" CHECK goes.
- `supervisors` dropped.

## Migration

SQLite cannot alter FKs/CHECKs in place, so `migrateLegacySupervisors()`
(`app/db/migrate.server.ts`, runs on boot when the legacy `supervisors` table
exists) rebuilds `salesmen`, `profiles` and `notification_deliveries` inside
**one transaction** with foreign keys off, then runs `PRAGMA foreign_key_check`
and aborts (rolling everything back) on any violation:

- every supervisor becomes a **new salesman row** (same name and WhatsApp,
  status *aktif*, new id after the existing ones);
- existing salesman ids are preserved, so customers/transaksi/logs stay valid;
  each subordinate's `supervisor_id` is re-pointed at the converted row
  (dangling → null);
- supervisor-role profiles get `salesman_id` = the converted row;
- supervisor deliveries keep their history as `recipient_kind='supervisor'`.

It is a no-op once `supervisors` is gone (idempotent across boots) and is
covered by `tests/migrate-supervisors.test.ts` on a synthetic legacy database
(happy path, constraints after migration, idempotency, full rollback).

**Rollout rule:** applying this to a shared/production database is a shared
migration and needs explicit approval at deploy time, with a file-level backup
of the SQLite DB taken first (`docs/runbook-sigula.md`). It has so far only
run against the local dev DB.

## Consequences

- Positive: one entity, one screen, one place for a person's WhatsApp number;
  supervisors can have their own customers; hierarchy of any depth.
- Negative: a supervisor's summary and their own reminder can arrive as two
  messages to the same number; management's per-supervisor numbers (direct
  reports) differ from a supervisor's own dashboard (whole subtree) for
  multi-level teams — by design, documented above.
- Reversal is hard: after conversion supervisors are ordinary salesman rows;
  going back means a new migration plus a way to tell them apart. Hence the
  backup requirement.
- Supersedes the wording of the FRD/TDD (Supervisor entity, `Profile.supervisor_id`,
  FR-14/FR-28, BR-9); see the amendment notes at the top of those documents.
