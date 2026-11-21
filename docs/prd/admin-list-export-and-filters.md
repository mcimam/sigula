# PRD — Admin list export and structured filters

| | |
|---|---|
| Status | approved |
| Owner | SiGula |
| Date | 2026-11-20 |
| Track | production |
| Requirement | Grilled 2026-11-09 (recorded in `.agents/work/STATE.md`) |

## Problem

An admin cannot take a defined subset of SiGula data (for example overdue
customers of one team, or one month's transaksi) out of the product to report
to superiors or analyse in Excel. Admin lists today only offer free-text
search (`q`) and Aktif/Terhapus. Role dashboards already export reminder and
team summaries; those shapes do not answer ad-hoc admin list questions.

## Who has it

| Actor | Situation today | Cost of that |
|---|---|---|
| Admin | Must copy from the UI or ask engineering for a one-off query | Slow, error-prone reporting to superiors |
| Sales / ops superiors | Receive incomplete or manually assembled Excel | Decisions lag behind the live list |

## Why now

Pilot usage needs reporting from the live Customer (then Transaksi) lists
without waiting for a bespoke report each time. The grilled requirement and
filter set are agreed; iteration 1 unblocks the primary overdue-by-team case.

## Success criteria

| # | Criterion | How it is measured |
|---|---|---|
| 1 | Overdue customers of team X become an `.xlsx` in ≤ 3 clicks after filters are set | Manual check on Customer list |
| 2 | Export row count equals the list's "of N" (filtered mode) or the ticked count (selected mode) | UI count vs file row count; automated test |
| 3 | Date columns open as real Excel dates (pivotable) | Open in Excel / LibreOffice |
| 4 | Every export leaves an audit entry (user, list, filters, row count) | Log Audit → Export section |
| 5 | Out-of-scope or non-matching selected ids never appear in the file | Automated test |
| 6 | A filtered URL reproduces the same rows after reload | Manual + filter unit tests |

## Non-goals

- Export on salesman / supervisor / management pages (existing role reports stay)
- CSV, PDF, scheduled export, multi-sheet workbooks
- Re-import round-trip of the exported file
- Cross-page "select all"
- A filter-info header row inside the sheet
- A new export permission (read/manage of the list is enough)
- Extra "report-only" columns beyond the list + id + createdAt until a sample
  superior report exists

## Proposed solution

Add URL-driven structured filters on admin lists, a toolbar **Export** of every
row matching the current filters (all pages), a bulk-bar **Export terpilih** for
ticked rows on the current page, a per-list column picker remembered in the
browser, and append-only `export_logs` shown on Log Audit. Ship in iterations:
1 Customer · 2 Transaksi · 3 Salesman, User, Log Audit.

## Assumptions

- Pilot volumes fit in-memory filter + synchronous `.xlsx` generation.
- Read/manage access to the list is acceptable for export; audit is the control.
- New filter query params coexist with `q` / `trash` / `page` / `pageSize`
  (action redirects that drop unknown params remain a known debt to watch).

## Iterations

| # | Scope |
|---|---|
| 1 | Customer filters + export + audit (this delivery) |
| 2 | Transaksi filters + export |
| 3 | Salesman, User, Log Audit |
