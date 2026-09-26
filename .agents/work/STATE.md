# Project state

> The agent reads this at the start of every session to find out where things
> stand. Keep it current.

| | |
|---|---|
| Project | SiGula |
| Track | production |
| Phase | deployment |
| Updated | 2026-09-26 |

## Now

**Pengaturan tabs → sidebar submenu (2026-09-26):** "Koneksi WAHA" and "Jadwal
Cron" are now submenu entries under Pengaturan in the sidebar (same `NAV`
`children` mechanism as Data Master; `?tab=waha|cron`, no `?tab` = Koneksi WAHA).
The in-page tab buttons and the duplicated card headings are gone; the page
title reads `Pengaturan · <tab>`. `NavItems` no longer hardcodes "customer" as
the default tab. UI only — no route, intent, or schema change. Verified:
typecheck clean, `npm test` 132/132, Playwright on an isolated scratch DB
(desktop 1440 + mobile 390: submenu shown only on Pengaturan, default + explicit
highlight, save_cron / invalid cron / test_waha keep the tab, unknown `?tab`
falls back to WAHA, Data Master submenu unchanged, drawer closes on tap, no
horizontal overflow, no console errors). Uncommitted, not deployed.

**Excel import → upload dialog, modular (2026-09-26):** The "Upload Excel" card
above the Transaksi table is gone. An upload icon left of "+ Tambah transaksi"
opens a native `<dialog>`: drag & drop or pick a `.xlsx`, "Unduh contoh
template" link, then a preview (counts + row table, capped at 100 shown) that
the admin confirms or cancels (Batal / × / Esc / backdrop). The unknown-sheet
"treat as new salesman" option is now a tick that gates the confirm button;
confirm is also disabled when there is nothing to import. Unreadable files now
give a message instead of a 500 (FRD error path). Per the user, the feature is
**modular and used only on Transaksi for now**: `UploadDialog.tsx` (client) +
`upload.server.ts`/`upload.ts` (server + shared contract); a record supplies
`parse`, `confirm`, `describePreview`, `describeResult` (recipe in
`.agents/context/codemap.md` §11). No other record uses it. Verified: `npm test`
96/96 (12 new in `tests/upload.test.ts`), typecheck clean, `npm run build` OK
(no server code in the client bundle), Playwright 27 assertions on an isolated
scratch DB (desktop 1440 + mobile 390: layout, drop/pick, template download,
client + server validation, preview, gate, cancel + discard, Esc/backdrop, row
cap, confirm → result → table refresh, no console errors). Uncommitted.
Closing the dialog sends a best-effort `discard`; the 30 min TTL (DEBT-006) is
the backstop.

**Salesman hierarchy, drawer buttons, record activity log (2026-09-26):**
1. **ADR-0004** (`docs/adr/0004-…`): the `supervisors` table is gone —
   `salesmen.supervisor_id` is a self-FK (salesman 1—N salesman), user's
   answers: drop the table / keep the `supervisor` role linked to a salesman /
   free multi-level. Cycles and self-supervision rejected (app + DB CHECK);
   deleting a salesman with subordinates is blocked (a whole subtree can be
   deleted in one batch, children first). "Team" = whole subtree for the
   supervisor dashboard/export, direct reports for WhatsApp summaries and the
   management per-supervisor table (partition, no double counting).
   `notification_deliveries.recipient_kind` replaces the supervisor FK.
   `migrateLegacySupervisors()` converts an old DB in one transaction
   (FK-checked, rolls back on violation). **Applied only to the local dev DB**
   (it auto-ran when the dev server hot-reloaded, so there is no pre-migration
   backup of the dev data; integrity + FK check clean). **Production is NOT
   migrated — needs explicit approval + a file backup first** (runbook
   "Upgrade note — ADR-0004").
2. **Drawer header buttons** `⋮` (Salin tautan, Hapus record with inline
   confirm; delete disabled for your own user account), `⤢` expand/collapse,
   `×` close; Esc closes the menu first, then the drawer.
3. **Activity log**: new `activity_logs` table + `app/lib/activity.server.ts`;
   create/update/delete of Transaksi, Customer, Salesman, User (incl. Excel
   import creations, reason-code "bangkrut", reactivation, reassign) record
   actor + field diffs by name; passwords only as "(diubah)"; snapshots survive
   record/actor deletion. Shown as "Aktivitas" in each record's drawer and a
   filterable/searchable/paginated section on Log Audit (FR-31).
   Sidebar "Data Master" now has Customer/Salesman/User submenu.
Verified: `npm test` 84/84, typecheck clean, Playwright 36 + 30 assertions
(desktop 1440 + mobile 390, all four roles' relevant screens, no console
errors). Uncommitted. Interpretation note: "tiga tombol di sidebar" was read as
the three header buttons of the side panel (the user calls that panel
"sidebar").

**Edit/Tambah via side drawer (2026-09-26):** Per user request (design-system
"Edit item" panel), inline per-row edit forms and the "Tambah …" cards above
the tables were removed. Rows on all 4 tables (Transaksi + Customer/Salesman/
User) are now compact read-only lines; clicking a row (or its Edit button)
opens a right-side drawer, and "+ Tambah …" opens the same drawer in create
mode. Drawer state lives in the URL (`?edit=<id>` / `?edit=new`), so save
(action redirect), close, Esc, backdrop, paging and deep links need no client
state. New `app/components/RecordDrawer.tsx`; server actions/intents are
unchanged. This supersedes the `.edit-row-form` mobile fix (removed with the
forms it patched); tables now have zero horizontal overflow at 390px. Verified
by Playwright at 1440px + 390px (33 assertions: open/close paths, edit + save
flash, create on every tab, deep link, unknown id, checkbox not opening the
drawer, bulk delete, no console errors); `npm test` 55/55, typecheck clean.
Uncommitted. Note: after Simpan the redirect still drops `q/page/pageSize`
(pre-existing behaviour of every action here).

**Table mechanism redesign — Transaksi + Data Master (2026-09-22):** Per
user request, adopted a checkbox-select + bulk-delete-bar + search +
pagination mechanism (modelled on a shared Claude Design reference, restyled
to SiGula's existing light teal/slate system rather than the reference's
dark theme — user's explicit choice) across `/admin/transaksi` and all 3
Data Master tabs (Customer/Salesman/User). Per-row "Hapus" buttons removed;
delete now happens only via row checkboxes + a "N dipilih / Hapus terpilih /
Batalkan pilihan" bar, confirmed by the user. New shared module
`app/components/DataTable.tsx` (`useRowSelection`, `paginate`,
`TableToolbar`, `BulkActionBar`, `TablePagination`, `SelectAllCheckbox`)
backs all 4 tables to avoid quadruplicating the logic. New lib functions
`deleteTransaksiMany`, `deleteCustomersMany`, `deleteSalesmenMany`
(all-or-nothing — pre-checks every id for linked customers/transaksi before
deleting any, so a blocked salesman can't leave the batch half-applied),
`deleteUsersMany` (refuses a batch containing the acting admin's own id; that
row's checkbox is disabled in the UI too). 8 new tests
(`tests/orders.test.ts`, `tests/masterdata.test.ts`), `npm test` 55/55
green, `npm run typecheck` clean.

Found and fixed a real bug mid-build: after a bulk delete redirects back to
the same `?page/q/pageSize` URL, the selection `useState` doesn't reset
(component isn't remounted), so the bulk bar kept showing stale "N dipilih"
for already-deleted rows. Fixed by deriving the *displayed* selection as an
intersection with the current page's actual row ids on every render
(self-healing), not just an effect keyed on URL params.

Also found the checkbox column's extra width tipped the Salesman/User tabs'
inline edit-row forms (4-5 fields each) into genuinely overflowing on mobile
— the Simpan button was unreachable without horizontal scroll, not just a
cosmetic truncation. Fixed with a `@media (max-width: 480px)` rule scoped to
a new `.edit-row-form` class (not a blanket `.form-control` change, which
would've also shrunk the full-width login inputs) that stacks each field to
one-per-row below that breakpoint. Verified via `getBoundingClientRect`
against `.table-wrap`'s actual visible bounds (not just `clientWidth`, which
gave false positives earlier) — Simpan is now reachable on all 4 tabs at
390px, and desktop text no longer truncates. This closed DEBT-011 (paid, not
just documented).

Verified via Playwright screenshots + functional checks at both 1440px and
390px: search, pagination (Records X–Y of Z, Prev/Next, page numbers, Go-to),
bulk select/delete, and individual Simpan edits all work on every tab; a
full 4-role smoke pass (login → dashboard, no console errors) confirms
nothing else regressed. Not yet deployed — still local dev only; changes are
uncommitted.

**Visual UI/UX pass (2026-09-22):** Playwright walkthrough (Chrome extension
unavailable in this environment — no X display) against local dev server,
all 4 roles, desktop (1440px) + mobile (390px). Dashboards consistent across
roles, batch trigger flow works end-to-end including graceful WAHA-down
handling (failed badges + retry/delete). Found and fixed a mobile-only bug:
on `/admin/transaksi`, the "Hapus" button lived in its own table column,
which pushed it outside the visible viewport on mobile inside the table's
horizontal-scroll container with no scroll affordance — admins on a phone
had no visible way to delete a transaction. Fixed by moving the delete
`Form` into the same `<td>` as the edit form (`app/routes/admin.transaksi.tsx`),
matching the pattern already used in `admin.masterdata.tsx`. Verified: mobile
screenshot shows Hapus inline below Simpan, desktop layout unaffected,
`npm run typecheck` clean, `npm test` 47/47 green, functional delete
re-verified via Playwright (3 rows → 2 after click). Not yet deployed to
production — still local-only.

**Production live (2026-09-14):** `https://sigula.ceater.cc` on VPS
`194.233.71.161` — `/home/sigula/sigula`, podman container `sigula` bound
`127.0.0.1:3010`, Caddy TLS reverse proxy. Runbook:
`docs/runbook-sigula.md`. Change seeded demo passwords before sharing widely;
configure WAHA API key under Admin → Pengaturan (host WAHA at
`127.0.0.1:3002` / `waha.ceater.cc`).

**Repo hygiene (2026-09-14):** root `README.md`, tightened `.gitignore` /
`.dockerignore`, `data/.gitkeep`, `engines.node >=22`, `.env.example`
documented. Remote `origin` → `git@github.com:mcimam/sigula.git`.

**Full stack rewrite: Django → React Router 7 (framework mode) JS monolith**
per user choice (option C, install approved). Recorded as ADR-0003.
`context/stack.md`, `context/architecture.md`, `config.yml` commands/paths,
and the TDD summary updated. Python/Django tree removed (it was never
committed to git — rewrite rebuilt behaviour from FRD/TDD + the service
logic captured earlier in-session).

Runnable app:
- React Router 7 + React 19 + Tailwind 4 + Drizzle/better-sqlite3 + exceljs + bcrypt
- Role dashboards: Admin (trigger/import/masterdata/audit), Salesman,
  Supervisor, Management
- Seed demo users on first boot (`admin`/`salesman`/`supervisor`/`management`,
  password `sigula123`)
- `npm run typecheck` clean; `npm test` 6 BR-1 unit tests green
- Visual verification via Playwright (headless Chromium) against a mock WAHA:
  login → admin trigger (eligible 2→0, deliveries `sent`) → salesman pending
  + reason submit → supervisor/management dashboards. Screenshots in
  `.agents/work/notes/01-*.png` … `09-*.png`. Chrome DevTools MCP unavailable
  here (no X display); Playwright used instead.

**Open follow-ups (debt):** thin automated suite (`DEBT-007`, major), future
date on import (`DEBT-001`), in-memory import preview (`DEBT-006`), no
ESLint yet (`DEBT-008`). Testing-phase gates from the Django era need to be
re-run against the new stack before Deployment.

Dev server: `npm run dev` → http://localhost:5173
(WAHA optional: `WAHA_BASE_URL=http://127.0.0.1:3000`).

## Problem statement

Salesmen at a Yogyakarta sugar/food-ingredient distributor lose track of
customers who go quiet past their normal reorder cycle. There is no
systematic process today — looser even than the existing
`Order_Tracker_2026.xlsx` — so overdue accounts get noticed late, or not at
all, and follow-up is inconsistent across the team.

## Success criteria

- Fewer customers cross their own overdue threshold before a salesman
  follows up, vs. today's ad hoc process.
- Pilot team's usage is manually confirmed workable before full-scale rollout.

## Non-goals

- Order product/quantity/value tracking.
- Automated messaging to end customers.
- Admin-configurable reason taxonomy at launch.
- Full company-wide rollout in v1.

## Open unknowns

| Unknown | Blocks | Owner |
|---|---|---|
| Salesman→supervisor org chart (seed has one demo link) | Real org onboarding | User |
| Dedicated WhatsApp number + VPS for WAHA | Real WhatsApp sending; Deployment | User / Deployment |
| Numeric success threshold for "fewer overdue" | Objective pilot graduation | User |

## Task list

- [x] ADR-0003 + stack/architecture/config rewrite to React Router 7
- [x] Schema + auth + seed
- [x] Domain services (orders, reminders/WAHA, import, export, masterdata)
- [x] Role routes + teal/slate UI shell
- [x] Typecheck + BR-1 unit tests
- [x] Visual Playwright walkthrough with mock WAHA
- [x] Rebuild automated suite to production-track depth (`DEBT-007`)
- [ ] Re-run `/qa` + `/secure` + manual plan on the new stack
- [ ] Deployment phase (containerize / CI / runbook) — not started

## Debt

| | |
|---|---|
| Open | 4 — 0 blocker, 1 major (DEBT-009), 3 minor |
| Next to pay | DEBT-009 — amend FRD/ADR for editable transaksi + hard deletes, or revert |

## Now (update)

**DEBT-007 paid (2026-09-12):** vitest suite rebuilt to meaningful production
depth for the RR7 port — isolated temp SQLite (`tests/setup.ts` +
`tests/helpers/fixtures.ts`), 38 tests across `dates` / `orders` /
`reminders` (incl. FR-3 double-trigger regression) / `masterdata` /
`imports` / `reports` / `auth`. `npm test` green. Route-level HTTP
permission matrix still thinner than the old Django view suite; covered
for now by Playwright smoke + `requireRole` usage — reopen as new debt
only if a regression slips through without a service-level signal.

## Deployed

| Env | Version | Deployed | Rollback |
|---|---|---|---|
| production | `5366902` @ `sigula.ceater.cc` | 2026-09-14 | `git checkout <sha> && podman-compose up -d --build` (see runbook) |
## Decisions log

| Date | Decision | Where recorded |
|---|---|---|
| 2026-09-12 | Replace Django monolith with React Router 7 (framework mode) JS monolith | `docs/adr/0003-react-router-vs-django.md` |
| 2026-08-31 | WAHA over Meta Cloud API | `docs/adr/0001-waha-vs-meta-cloud-api.md` |
| 2026-08-31 | Manual notification trigger only | `docs/adr/0002-manual-notification-trigger.md` |

## Parked

- Configurable reason taxonomy — revisit once the fixed 3 codes prove insufficient.
