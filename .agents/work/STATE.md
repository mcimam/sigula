# Project state

> The agent reads this at the start of every session to find out where things
> stand. Keep it current.

| | |
|---|---|
| Project | SiGula |
| Track | production |
| Phase | deployment |
| Updated | 2026-09-26 (deployed) |

## Now

**DEPLOYED to production 2026-09-26 16:37Z — `master` = `89d8bc4`** (user approved the deploy and the credential rotation).
The old production database was the pre-migration schema (2 accounts, 555 customers, 822 transaksi, 10 salesmen + 1 legacy
supervisor); the new build migrated it on boot (10 migrations, integrity ok, counts unchanged, salesmen 11). Verified from
outside: headers via Caddy, login page prints no demo password, admin login with the new password, the old demo password and
the demo `salesman` account refused, every admin page 200, container healthy. Downtime ≈ 5–10 s.
- **Backup** `/home/sigula/backups/sigula-pre-erdv2-20260926T163042Z.db` (root, 600) and **image**
  `localhost/sigula_app:pre-erdv2-20260926T163042Z`. Keep them until the new version has been used for a while.
- **Rollback** (the migrated database cannot run on the old image): `cd /home/sigula/sigula && podman stop sigula && podman rm sigula;
  VP=$(podman volume inspect sigula_sigula-data --format '{{.Mountpoint}}'); rm -f $VP/sigula.db*; cp /home/sigula/backups/sigula-pre-erdv2-20260926T163042Z.db $VP/sigula.db;
  podman tag localhost/sigula_app:pre-erdv2-20260926T163042Z localhost/sigula_app:latest; git checkout d66972e; podman-compose up -d`. Anything written since the deploy is lost.
- **Credentials:** the production `admin` password was rotated to a random one (reported to the user in chat, not stored anywhere);
  the demo `salesman` account (no role) was deactivated. Both had the public demo password.
- **Still open for production:** WAHA is not yet pointed at `/webhooks/waha` (replies are not received; set
  `WHATSAPP_HOOK_URL` / `WHATSAPP_HOOK_EVENTS=message` and ideally a secret — DEBT-020), production users other than `admin`
  do not exist yet, and there is no salesman/supervisor/management login until the admin creates them (Data Master → User).
- **Build fragility found while deploying:** `podman-compose up -d --build` can fail (DEBT-026: `better-sqlite3` is compiled from
  source in the image and node-gyp's download of Node headers timed out). What worked: `podman build --jobs 1 --network=host -t
  localhost/sigula_app:latest .` then replace the container.

**Hotfix (2026-09-26, after the deploy): "Kirim pengingat kembali" failed with WAHA 500 in production.** Cause: the salesmen's WhatsApp
numbers were saved as `0812…` and the chat id was built from the digits as typed (`0812…@c.us`); production WAHA answers 500 for that and
200 (`numberExists`) for `62812…`. Fix: `normalizeWhatsappNumber` for sending and for matching replies, a plausibility check before sending,
and WAHA's explanation kept in the error (FR-47). Verified: 437 tests (6 mutations caught) and against production WAHA read-only
(`check-exists` 500 for the stored form, 200 for the normalised one). The same bug would have hit the batch reminder and made replies from
those salesmen "not a salesman".

**ERD v2 — R1, R3 and R2 DONE on branch `feat/erd-v2-foundation` (2026-09-26, not committed, not deployed).**
Design: `docs/erd-sigula.dbml`; decisions: ADR-0005 (R1), ADR-0006 (R3), ADR-0007 (R2). Migrations `drizzle/0000–0004`.
- **R1:** versioned migrations (own runner, FK-safe), soft delete + "Terhapus"/Pulihkan on Transaksi and the 3 Data
  Master tabs, `customer_assignments`, `customer_status_history`, `import_batches`, ISO-UTC timestamps, Jakarta business
  date, case-insensitive customer names.
- **R3:** `notification_runs`/`deliveries`/`items` (pending is derived, batches are voided not deleted, a retry is a new
  attempt), `salesman_contacts`, versioned `message_templates` (Pengaturan → Template Pesan; email seeded but hidden),
  `follow_ups` + `follow_up_reasons`, `app_settings` audit columns.
- **R2:** RBAC — `roles`/`permissions`/`role_permissions` (scope own/team/all)/`user_roles` replace `profiles`; several
  roles per user (checkboxes), `supervisor` kept as a permission bundle, `users.salesman_id/is_active/last_login_at`,
  `requirePermission` + `access.server.ts` guards, permission-driven sidebar, last-administrator guard.
Verified: `npm test` 310/310 (23 files), `tsc` clean, `npm run build` OK (client bundle has no schema/server code),
`drizzle-kit check` OK; migrations exercised on a legacy DB with data (tests; deliberate breakages caught) and on a copy
of the real dev DB; HTTP matrix of 14 routes × 4 old roles identical to pre-RBAC behaviour; delete → trash → restore,
template edit/reject, trigger → retry → void, follow-up, user/role admin flows checked over HTTP; dashboard, Template
Pesan, Terhapus, user list/drawer and the multi-section sidebar checked in a browser.
- **List search bar (UI, after the design system):** the Aktif/Terhapus filter now lives inside the search bar
  (`app/components/TableSearch.tsx` — chip, "Bersihkan", suggestions with counts) on the three Data Master tabs and
  Transaksi; the separate switch is gone. Transaksi **keeps** soft delete (decision: no hard delete, no data change).
  Checked in a browser on customer/salesman/user tabs and Transaksi: pick filter with text typed, search inside
  Terhapus, chip ×, Backspace in the empty input, "Bersihkan". Re-verified: `npm test` 267/267, `tsc` clean, build OK
  (no server code in the client bundle), `drizzle-kit check` OK. No component tests exist (vitest runs in node), so
  the bar's behaviour is covered by the browser check only.
- **Customer panel & follow-up log (FR-33..35):** the drawer's ⤢ button now opens a true full page (design system:
  100vw, two field columns, Aktivitas beside the form; was a 780px widening). Customer Status is a toggle at the
  top of the panel (saved with Simpan; the design system's stand-alone toggle applies at once — say if that is
  wanted). The customer list and panel show the last transaksi date and an order status (Overdue / On track,
  BR-1 via `orderStanding`, computed at read time). Every reason a salesman gives is now written to the activity
  log on the customer (`alasan_keterlambatan`, with the status change in the same entry when it deactivates) —
  the old test that said "other reasons log nothing" was rewritten for the new rule. Not added: a free-text note
  with the reason (`follow_ups.note` exists if wanted). Checked in a browser as admin (list columns, panel, full
  page, deactivate → list → reactivate); the salesman reason flow is covered by unit tests only.
- **Comments, reasons, paging, message v2 (ADR-0008, FR-36..39, migrations 0005–0006):** every record panel now has
  "Aktivitas & komentar" (composer + log entries and comments in one newest-first list, 10 per page). Reasons for a
  late customer are given from the customer's panel; the salesman dashboard no longer has reason buttons (a row opens
  the view-only panel). Log Audit's three lists are paged in SQL (no 2,000-row cut). The salesman WhatsApp text is the
  new format (numbered list, longest wait first, date, reasons). Verified: `npm test` 310/310 (7 + 6 mutations on the
  new logic all caught), `tsc`, build; browser as admin (feed, composer, feed paging, Log Audit paging and search).
  Production DB gets migrations 0005 and 0006 on first start after deploy (0007 too, see below).
- **WhatsApp replies via the WAHA webhook (ADR-0009, FR-40..43, migration 0007):** `POST /webhooks/waha` (HMAC-SHA512
  under `waha.webhook_secret` — **optional**: checked only when a secret is set; with none the endpoint is open, so a
  forged reply from a known salesman's number would be accepted — the settings page and ADR-0009 say so) reads a salesman's reply — `3 Kalah Harga`, `1,2 …`,
  `1-3 …`, one pair per line, or a bare reason for everyone still waiting in that reminder — records it through the same
  `submitReason` as the panel ("… (via WhatsApp)"), and answers with a short confirmation (how-to at most once an hour;
  strangers, groups and our own messages are never answered). Each message is processed once (`inbound_messages`,
  unique WhatsApp id) and listed in Log Audit ("Balasan WhatsApp", paged). Reminders now store each customer's line
  number (`notification_items.position`). Verified: `npm test` 421/421 (+ 12 mutations on the new logic, all caught);
  browser check of the settings field and audit section still to be done by a person. **Not done and needs you:** WAHA
  must be pointed at the endpoint (env `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS=message`, `WHATSAPP_HOOK_HMAC_KEY`,
  restart) and the same secret set in Pengaturan — see the runbook; nothing was tested against a live WAHA.
  **Risk accepted by the user:** a bare "Sudah Bangkrut" deactivates every customer of that reminder still waiting.
- **Security review and release preparation (2026-09-26):** fixed — no default credentials in production (no demo seed, the
  login page no longer prints the demo password in a production build, admin-set passwords ≥ 8 characters and never
  `sigula123`), security headers, GET `/logout` no longer logs out, webhook body cap and privacy limits (strangers' text not
  kept, rows bounded), unused imports. Open — DEBT-019…025 (no CSP; webhook signature optional = open without a secret;
  container runs as root; `*.ceater.cc` in `allowedActionOrigins`; `uuid` advisory via exceljs, not reachable; no rate
  limits; no written retention policy). The ledger is now past its review threshold (19 open) — worth a `/debt review`.
  Rehearsed: production build against a copy of the dev DB rolled back to 0007 → 0008–0009 applied, integrity OK, every
  role's pages 200/403, webhook 200/401/413. **Not done, needs you:** rotate any production account still on the demo
  password (the old build prints it on the login page), decide the webhook secret, approve the push and the production
  deploy — see the runbook's *Release checklist*. `.env.example` was not touched (access denied): add `ADMIN_USERNAME=`,
  `ADMIN_PASSWORD=`, `WAHA_WEBHOOK_SECRET=` if you want them listed.
- **"Kirim pengingat kembali" (FR-46), not committed yet:** ⋮ menu of an overdue customer's panel → confirm → one reminder to
  that customer's salesman (`resendReminder`), noted in the customer's activity, refused for inactive / not overdue / no
  number / reminded < 10 min ago, needs `notification.manage`. Also changed: a customer's *newest* reminder alone decides
  "pending" (before, an unanswered older reminder would have kept a customer pending after it was reminded again and
  answered). Verified: 421 tests (+ 8 mutations, all caught) and in a browser against a fake WAHA — the message text, the
  panel staying open with the result, the 10-minute refusal, no menu item for a customer that is not overdue.
- **Dashboard review (no new behaviour):** KPI tiles restyled to the design system (`StatTile`), one stale sentence on
  the admin dashboard fixed. Findings not acted on (need a decision): salesman dashboard lists only *pending* customers
  while "Perlu follow-up" counts every overdue one, so after a reason the list is empty but the stat is not; the admin
  preview shows names as one comma list (the message is now a numbered list); no "recent activity" block although the
  design has one and `listActivityPage` could feed it; the void action uses the browser's `confirm()`; page content is
  capped at 1100px so wide screens leave empty space.
- **Admin dashboard rework (2026-09-26, user request; no schema change):** copy rewritten in Indonesian ("Perlu
  diingatkan" instead of "eligible", "pengiriman" instead of "batch", delivery statuses as "terkirim / gagal /
  dilewati — tanpa nomor WA", shorter empty-state text); the run history is paged 5 per page (`runsPage`,
  `TablePagination`, `?page=`; retry/cancel stay on the page, a new send lands on page 1). **Behaviour change
  (decided by the user, amends ADR-0006):** a message that was sent cannot be cancelled — `voidBatch` refuses a run
  with any `sent` delivery and the dashboard shows "Batalkan pengiriman" only for a run that delivered nothing, so
  an admin can no longer free customers to be reminded again; that now happens only when the salesman gives a reason
  or an order arrives. Runs voided earlier keep their effect. Tests that voided a *sent* run were moved to
  `voidRunLegacy` (a fixture that writes the old-style voided row) so the pending logic stays covered; new tests for
  the refusal (4 mutations caught + a fifth added after one survived) and for `runsPage`. Verified: `npm test` 421/421,
  `tsc`, build (no server code in the client bundle); browser on a scratch DB with 15 runs at 1440 / 390 / 320 px:
  paging (Next, Prev, Go to, stale page clamps), retry / cancel / trigger flows, a stale POST voiding a sent run is
  refused, no horizontal scroll. Not changed: the shared pager still reads "Records 1–5 of 13 / Prev / Next / Go to".
**Before any production deploy (ask-first):** back up the volume; run the case-insensitive duplicate-name query from the
runbook ("Upgrade note — ERD v2") — migration 0001 aborts on such names. Not yet done: commit, push/PR, production migration.
**Fixed 2026-09-26 (user-reported `SqliteError: no such column: users.salesman_id`):** migrations were triggered only by the root
loader, so a first request that skipped it ran on the old schema. They now run when the database is opened
(`client.server.ts`), in dev on the first request and in production at server start; regression test
`tests/boot-migration.test.ts`. The dev DB was backed up before it got migrated (pre-R3/R2 state, outside the repo).
**Heads-up:** a running `npm run dev` already migrated `data/sigula.db` (no backup of the pre-R1 state); a first page load
after a fresh dev-server start re-optimises dependencies and can freeze a browser tab once (dev only).
Open debts from this work: DEBT-013 (no purge), 014 (only WhatsApp sends), 015 (follow-up outcomes without UI), 016 (import
file hash not checked), 017 (no role/permission editor), 018 (role↔salesman rule is app-level); DEBT-009 mitigated;
DEBT-012 extended.

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
