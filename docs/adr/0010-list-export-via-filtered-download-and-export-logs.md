# ADR-0010 — List export via filtered download route and `export_logs`

| | |
|---|---|
| Status | accepted |
| Date | 2026-11-20 |
| Deciders | Plan for grilled requirement 2026-11-09 (Export + list filters) |
| Builds on | ADR-0004 (team = subtree), ADR-0005 (activity trail), exceljs usage in reports |

## Context

Admins need `.xlsx` of the **current filtered admin list** (and of ticked
rows), with an audit trail of who exported what. Two existing mechanisms look
close but do not fit:

- Role reports (`reports.server.ts`) are fixed shapes for salesman /
  supervisor / management dashboards.
- `activity_logs` records create/update/delete/restore on a single entity id;
  a list export is not a mutation of one record and would force fake
  entity ids or a CHECK/enum migration for a poor fit.

Client-only Excel generation was also considered: it would skip server
authorization and make a trustworthy audit hard.

## Options considered

### Option A — Extend `activity_logs` with action `export`

- **How:** add action (+ maybe entity type); store filters in `changes`.
- **For:** one audit UI already exists.
- **Against:** entityId is mandatory and meaningless for a list; CHECK
  constraint and feed semantics (panel "Aktivitas") get polluted.

### Option B — Client-side `exceljs` / SheetJS in the browser

- **How:** build the file from the current page's JSON.
- **For:** no new route.
- **Against:** only sees the current page unless the loader ships all rows;
  easy to spoof; audit would be a separate round-trip that can be skipped.

### Option C — Resource route + `export_logs` (chosen)

- **How:** GET/POST `/admin/export/customer` re-applies filters server-side,
  intersects selected ids, writes `export_logs`, returns xlsx (same response
  pattern as `reports.*.tsx`).
- **For:** authorization and row set owned by the server; audit is append-only
  and list-shaped; activity trail stays clean; reusable for later lists.
- **Against:** new table and audit section; duplicate filter application
  (loader + export) — accepted, shared helper removes drift.

## Decision

We chose **Option C**.

**Why the others lost.** Activity logs are the wrong grain for list exports;
client-only export cannot enforce BR-E1 (selected ∩ filtered) or a reliable
audit without becoming a server call anyway.

## Consequences

**Accepted costs:** migration `0010`; Log Audit gains an Export section;
filter logic must stay in a shared module.

**What this makes easy:** Transaksi/other list exports reuse the same route
pattern and log table (`list_key`).

**What would make us revisit:** if export volume needs streaming SQL, or if
compliance requires exports inside the per-record activity feed.
