# ADR-0008 — Record comments, reasons on the customer panel, paged logs, reminder text v2

| | |
|---|---|
| Status | accepted (implemented on branch `feat/erd-v2-foundation`; not deployed) |
| Date | 2026-09-26 |
| Deciders | User (chat: reasons are entered on the customer's panel; the panel gets "Activity & comments" as in the design system; activity and log get pagination; new WhatsApp text). Two choices confirmed by the user: reasons live in the customer panel with the reason picker, and giving a reason still ends the reminder's pending state |
| Builds on | ADR-0005 (activity log, soft delete), ADR-0006 (follow-ups, templates), ADR-0007 (permissions and scope) |

## Context

A salesman answered a reminder with one click on a reason button on the dashboard. That was the only way, it left no
message, and the reason was not visible where the customer is looked at: only "Sudah Bangkrut" reached the activity
log, because it changed a status. The design system's record panel has a different idea of a record's history — a
comment box and one list of log lines and messages. Log Audit listed its activity in memory (a hard cut at 2,000 rows)
and its salesman-moves and status-change lists showed only the last 50, with no paging. The reminder text was a
single sentence with the customer names joined by commas.

## Decision

1. **Comments** (`record_comments`, migration 0005): entity type + id (no FK, like `activity_logs`), body (not empty,
   at most 2,000 characters), author with a name snapshot, time. Never edited or deleted. Every record panel
   (transaksi, customer, salesman, user) shows "Aktivitas & komentar": a composer, then log entries and comments in
   one newest-first list.
2. **The feed is paged in SQL** (a `UNION ALL` of the two tables' keys, ordered by time; within one second a comment
   sorts before the log entry so "reason, then message" reads in order). 10 entries per page, page in `?activityPage=`.
3. **Who may comment**: whoever manages that kind of record (`transaksi.manage`, `masterdata.manage`), and for a
   customer also the salesman it belongs to (`customer.follow_up`, own/all scope). One function decides this
   (`assertCanUseThread`); no new permission was added (that would be a migration and a role change for nothing).
4. **Reasons move to the customer panel.** The composer on a late, active customer offers the reasons; giving one
   records the follow-up exactly as before (ends the reminder's pending state; "Sudah Bangkrut" still deactivates) and
   writes it to the customer's activity (`alasan_keterlambatan`, in the same entry as the status change if there was
   one). A message typed with the reason follows it as a comment. The dashboard keeps the pending list and opens the
   panel (view-only for a salesman); it has no reason buttons. `salesman/customers/:id/reason` is replaced by one
   route, `/comments`, which every panel posts to with a fetcher (a `<form>` would nest inside the panel's own form).
   Only a holder of `customer.follow_up` for that customer's salesman can give a reason — the admin role has none.
5. **Log Audit is paged in the database**: activity (filter and search run in SQL, including the Indonesian labels
   the page shows; `json_each` over `changes`), salesman moves (a move = an assignment that took over from an earlier
   one) and status changes, each with its own page parameter (`page`, `movePage`, `statusPage`). Nothing is cut off.
6. **Reminder text to salesmen, version 2** (migration 0006, data only): header with the salesman and date, numbered
   lines "NAMA — N hari (siklus normal M hari)" with the longest wait first (never-ordered first), and "Balas dengan
   alasan: …" from the reasons on offer. New placeholders `{{tanggal}}` (fixed month table, not `Intl`) and
   `{{daftar_alasan}}`; `{{daftar_customer}}` becomes the numbered list. It is added as the next version and only where
   the text is still the one migration 0003 seeded, so an admin's own text is kept.

## Consequences

- The reminder says "Balas dengan alasan". At the time of this ADR nothing read a WhatsApp reply; ADR-0009 (same day)
  added the WAHA webhook that does, so the panel and a reply are two ways to give the same reason.
- Comments are not in Log Audit (it is the append-only log of changes); they live on the record they belong to.
- The email templates keep their v1 text; `{{daftar_customer}}` now expands to the numbered list there too (email is
  hidden, DEBT-014).
- A test helper, `resetDb`, now restores the *seeded* template state (version 2 active for the salesman WhatsApp text)
  instead of assuming version 1.
