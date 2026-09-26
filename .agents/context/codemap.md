# Code map

> Read this **before** editing code, and open only the files it points you to.
> It exists so a session does not have to re-read the whole repo.
>
> **Snapshot:** 2026-09-26, git `d66972e` plus the uncommitted working tree
> (ADR-0004 hierarchy, record drawer, activity log, table mechanism, upload
> dialog, WhatsApp session panel). Built by
> reading every file under `app/` and `tests/`. No line numbers on purpose —
> they rot; functions are named instead. If a file disagrees with this map,
> **the file wins**: fix the map in the same change.
>
> **Last synced:** 2026-09-26 — Pengaturan's WAHA / Cron tabs became a sidebar submenu
> (`NAV` `children` in `AppShell.tsx`; in-page tab bar removed from `admin.settings.tsx`,
> page title is now `Pengaturan · <tab>`; `NavItems` default tab is the first child instead
> of a hardcoded "customer"). The WhatsApp session panel (`WahaSessionCard`, `waha-session`,
> `admin.settings.waha-session`) was mapped by a parallel change and is untouched here.
> *Update this line on every code change, even when no other
> section needed editing — it is the record that the review happened.*
>
> Business rules and requirement IDs (FR-/BR-) live in `docs/frd/`. Design
> decisions live in `docs/adr/`. This file is only *where things are and how
> they fit*.

## 1. What it is

SiGula — a React Router 7 (framework mode, SSR) monolith on Node 22+. It tracks
each customer's reorder cycle, flags overdue accounts, and sends WhatsApp
nudges (via WAHA) to salesmen and their supervisors. Four roles: `admin`,
`salesman`, `supervisor`, `management`. SQLite via Drizzle + better-sqlite3.
UI strings are Indonesian; code identifiers are English (domain nouns like
`nama`, `transaksi`, `tanggal_order` stay Indonesian).

Stack details: `.agents/context/stack.md`. Architecture summary:
`.agents/context/architecture.md`.

## 2. Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` → http://localhost:5173 |
| Typecheck (runs `react-router typegen` first) | `npm run typecheck` |
| All tests | `npm test` (vitest, single worker) |
| One test file | `npx vitest run tests/<file>.test.ts` |
| Build / start | `npm run build` / `npm start` |
| Lint / format | none configured (DEBT-008) |

Demo login on a fresh DB: `admin` / `salesman` / `supervisor` / `management`,
password `sigula123`. Production deploy is **ask-first** (`config.yml`).

## 3. Directory layout

```
app/
  root.tsx                 HTML shell + ErrorBoundary; root loader = DB bootstrap + cron start
  routes.ts                EXPLICIT route table (not file-based) — every route is registered here
  app.css                  Tailwind 4 import + `--sg-*` tokens + all custom classes (BEM-ish)
  components/
    AppShell.tsx           AppShell (sidebar/topbar + per-role NAV), PageHeader, StatTile, StatusPill
    DataTable.tsx          paginate, resolvePageSize, useRowSelection, TableToolbar, TablePagination,
                           BulkActionBar, SelectAllCheckbox
    RecordDrawer.tsx       URL-driven side drawer: parseDrawer, useDrawerHref, RecordDrawer,
                           EditLink, AddLink, useRowOpen (+ activity timeline)
    UploadDialog.tsx       record-agnostic upload modal: UploadButton (icon + native <dialog>,
                           drop/pick → preview → confirm/cancel), UploadPreviewView type
    WahaSessionCard.tsx    "Sesi WhatsApp" panel on Pengaturan → Koneksi WAHA: status pill, QR,
                           Login / Logout (inline confirm); polls the resource route every 4 s
  db/
    schema.ts              Drizzle tables, enums, relations, REASON_LABELS, Role/ReasonCode types
    client.server.ts       opens SQLite (WAL, foreign_keys ON); exports `db`, `sqlite`, `DB_PATH`
    migrate.server.ts      idempotent raw-SQL bootstrap + migrateLegacySupervisors (ADR-0004)
    seed.server.ts         seedIfEmpty(): migrate() then demo org/users/customers if `users` is empty
  lib/                     business logic — one module per ownership area (see §6)
    auth.server.ts  masterdata.server.ts  orders.server.ts  reminders.server.ts
    imports.server.ts  reports.server.ts  activity.server.ts  settings.server.ts
    cron.server.ts  waha.server.ts  upload.server.ts
    dates.ts  activity-format.ts  upload.ts  waha-session.ts   (no `.server` → safe to import in components)
  routes/                  one file per route: loader/action + page component
tests/
  setup.ts                 sets DATABASE_PATH (temp dir) + SESSION_SECRET BEFORE app modules load
  helpers/fixtures.ts      resetDb, seedOrg, addCustomer, getCustomer, TODAY
  *.test.ts                service-level tests (no route/HTTP tests)
docs/                      prd/ frd/ tdd/ adr/ runbook-sigula.md user-input/
                           erd-sigula.dbml (TARGET ERD draft, not yet implemented — schema.ts is the running schema)
.agents/                   agent scaffold: config.yml, context/, rules/, work/STATE.md, work/DEBT.md,
                           hooks/codemap-guard.mjs (Stop hook, see §14)
Dockerfile  docker-compose.yml   prod image + podman compose stack
```

Not app code, ignore unless asked: `.agents/skills|workflow|templates|commands`,
`.claude/`, `docs/user-input/`, `.react-router/` (generated types), `build/`, `data/`.

## 4. Conventions that hold everywhere

- **Alias** `~` → `app/`. **`*.server.ts`** = server-only (never import from a
  component; use `~/lib/activity-format` / `~/lib/dates` for shared bits).
- **Route types**: `import type { Route } from "./+types/<route file basename>"`
  — generated by `react-router typegen` (part of `npm run typecheck`).
- **Route file naming** is a convention only; registration is in `app/routes.ts`.
- **Auth guard first line of every loader/action**:
  `const user = await requireRole(request, "admin")` (or array of roles).
  Wrong role → `Response("Forbidden", 403)`; no session → redirect `/login?next=…`.
  Ownership checks (salesman owns customer; supervisor subtree) are done in the
  route/action itself and throw 403/404 `Response`s.
- **Forms** are RR `<Form method="post">` with a hidden `intent` field; the
  action dispatches on `intent` (`create` / `update` / `delete_many` /
  `create_customer` / `delete_many_user` …). Bulk-delete posts repeated
  `<idName>` fields (`transaksi_id`, `customer_id`, `salesman_id`, `user_id`).
- **Flash messages**: redirect to same page with `?flash=<Indonesian text>`;
  `AppShell` renders it. Redirects after an action **drop** `q/page/pageSize`
  (known, pre-existing).
- **List pages** (Transaksi, Data Master ×3, Audit): filter + paginate in memory
  in the loader via `paginate()`; URL params `q`, `page`, `pageSize` (10/25/50).
- **Drawer state is in the URL**: `?edit=<id>` or `?edit=new` (Data Master also
  `?tab=customer|salesman|user`). Loader resolves the record; page renders
  `<RecordDrawer>` when `creating || editing`.
- **Data types**: dates are `TEXT` `YYYY-MM-DD` (`todayIso()` uses machine-local
  TZ); timestamps are `TEXT` `YYYY-MM-DD HH:MM:SS` in **UTC**, shown in WIB by
  `formatStamp`; booleans are `integer({ mode: "boolean" })`. Cron runs in
  `Asia/Jakarta`.
- **DB naming** snake_case columns / camelCase in Drizzle; form fields snake_case.
- **Styling**: Tailwind utilities + custom BEM-style classes in `app.css`
  (`.app-*`, `.btn[-sm|-outline|-ghost|-danger|-warn]`, `.card`, `.table-wrap`,
  `table.data`, `.form-field`, `.form-control`, `.alert[-ok|-warn|-danger]`,
  `.status-pill--{ok,warn,danger,muted}`, `.stat-grid/.stat-tile`,
  `.drawer*`, `.upload-dialog*`, `.dropzone*`, `.btn-icon`, `.activity-list*`, `.table-toolbar`, `.bulk-bar`,
  `.table-pagination`, `.page-btn`, `.login-*`, `.action-row`, `.hide-sm`).
  Palette tokens `--sg-*` (teal brand, slate neutrals). Light theme only.
- **Comments** are sparse; they carry BR/FR/ADR/DEBT ids (`// DEBT-009`).
  Every shortcut needs a `DEBT-NNN` marker + a row in `.agents/work/DEBT.md`.

## 5. Database (`app/db/schema.ts` is the typed source; DDL is duplicated in `migrate.server.ts`)

| Table | Key columns / constraints |
|---|---|
| `users` | id, `username` UNIQUE, `password_hash` (bcrypt), `display_name` |
| `profiles` | `user_id` UNIQUE → users (CASCADE), `role` ∈ admin/supervisor/salesman/management, `salesman_id` → salesmen. CHECK: salesman/supervisor ⇒ salesman_id NOT NULL; admin/management ⇒ NULL |
| `salesmen` | `nama`, `nomor_wa` (default ''), **`supervisor_id` → salesmen (self-FK)**, `status` aktif/inactive. CHECK `supervisor_id <> id` |
| `customers` | `nama`, `salesman_id` → salesmen, `tipe_customer` lama/baru, `order_cycle_days` (CHECK ≥ 1, default 30), `status_customer` aktif/inactive, `last_order_date`, `notified` bool, `handled_on`. UNIQUE(`nama`,`salesman_id`) |
| `transaksi` | `customer_id`, `salesman_id`, `tanggal_order`, `sumber` seed/import/manual, `tanggal_input`, `catatan`. Editable/deletable (DEBT-009). `orderHistory` is a deprecated alias export |
| `reason_logs` | customer, salesman, `tanggal`, `kode_alasan` '1'/'2'/'3' |
| `notification_batches` | `tanggal` (datetime), `triggered_by_id` → users |
| `notification_deliveries` | batch, `salesman_id` (the *recipient*), `recipient_kind` salesman/supervisor, `customer_count`, `status` sent/failed/skipped_no_phone, `error_message` |
| `mutation_logs` | customer reassignment: `dari_salesman_id`, `ke_salesman_id`, `oleh_id` |
| `status_logs` | `tipe` manual_inactive/manual_reactivation/auto_reactivation, `oleh_id` nullable |
| `activity_logs` | `entity_type` transaksi/customer/salesman/user, `entity_id`, `entity_label` + `actor_name` (snapshots), `action` create/update/delete, `changes` JSON `{field:{from,to}}`, `created_at`; index (entity_type, entity_id, id); `actor_id` SET NULL on user delete |
| `app_settings` | key/value store: `waha.{base_url,session,api_key,timeout_ms}`, `cron.{enabled,expression,last_run_at,last_run_status,last_run_message}` |

**Two places define the schema** — `schema.ts` (Drizzle) and `migrate.server.ts`
(raw `CREATE TABLE IF NOT EXISTS`). Keep both in sync by hand; there is no
drizzle-kit config. `IF NOT EXISTS` **never alters an existing table**, so a
new column/constraint needs an explicit upgrade step like
`migrateLegacySupervisors` (rebuild table in one transaction, `foreign_key_check`
before commit). Migrating **production** is ask-first and needs a file backup.

Legacy path still in `migrate()`: one-time `order_history → transaksi` lift, then
`migrateLegacySupervisors()` (no-op once the `supervisors` table is gone).

**Bootstrap timing**: nothing runs at process start. The root loader calls
`seedIfEmpty()` (→ `migrate()` + demo seed if `users` empty, memoised promise,
`BEGIN IMMEDIATE`) and `ensureCronScheduler()` on page requests.

## 6. `app/lib` — who owns what (public functions)

**`auth.server.ts`** — cookie session `__sigula_session` (12 h, httpOnly, secure
in prod; **throws at import in production if `SESSION_SECRET` is unset/default**).
`getAuthUser`, `requireUser`, `requireRole`, `createUserSession`,
`destroyUserSession`, `verifyLogin`, `hashPassword`, `homeForRole`, in-memory
login throttle (`checkLoginThrottle` / `recordLoginFailure` / `clearLoginFailures`,
10 tries / 15 min per `x-forwarded-for:username`). `AuthUser.salesmanId` — for
role `supervisor` it is the **leading salesman** of the team.

**`dates.ts`** — `todayIso`, `daysBetween`, `parseIsoDate`, `daysSinceOrder`,
**`isOverdue`** (BR-1: never ordered ⇒ overdue; `days > cycle`, equal is *not*
overdue). Overdue is computed at read time everywhere, never stored.

**`orders.server.ts`** — `computeEligibleCustomers` (BR-2: `aktif` + overdue),
`notYetNotifiedEligible` (FR-3: also `!notified`), `eligibleCustomerCount`,
`syncCustomerLastOrderDate`, **`recordOrder`** (one transaction: insert
transaksi, `last_order_date = max(tanggal_order)`, force `aktif`, clear
`notified`/`handled_on`, `auto_reactivation` status log if it was inactive; then
logs activity), `listTransaksi`, `createTransaksi` (wraps `recordOrder`),
`updateTransaksi`, `deleteTransaksi`, `deleteTransaksiMany` (loop, not one tx).

**`masterdata.server.ts`** — hierarchy: `subordinateIds` (whole subtree, BFS),
`directReportIds`, `assertValidSupervisor` (rejects unknown/self/cycle).
Customers: `createCustomer`, `updateCustomer` (a salesman change delegates to
`reassignCustomer`, which writes `mutation_logs`), `reactivateCustomer`
(`manual_reactivation`), `deleteCustomerRecord` (cascades reason/transaksi/
status/mutation rows), `deleteCustomersMany`, `clampCycleDays` (BR-6).
Salesmen: `createSalesman`, `updateSalesman`, `deleteSalesman` (blocked by
customers / transaksi / remaining direct reports; also deletes linked
`profiles`), `deleteSalesmenMany` (**all-or-nothing**, children first).
Users: `createUserAccount`, `updateUserAccount` (password only logged as
"(diubah)"), `deleteUserAccount`, `deleteUsersMany` (refuses the actor's own id).
Stats: `salesmenWithStats(supervisorId?)` (subtree, excludes supervisor),
`supervisorsWithStats()` (management: **direct reports only** — a partition).

**`reminders.server.ts`** — `previewBatch` (per-salesman groups + per *direct*
supervisor groups), `triggerBatch` (null if nobody eligible; sends salesman
messages then supervisor summaries; flips `notified` only when a salesman-kind
send succeeds), `retryBatch` (re-sends `failed` deliveries), `deleteBatch`
(clears `notified` for salesman-kind recipients' customers), `submitReason`
(reason `3` ⇒ `inactive` + `manual_inactive`; every code sets `handled_on=today`,
`notified=false`), plus private `salesmanMessage` / `supervisorMessage` text.
`WahaClient` is injectable (`opts.client`) — tests pass a fake.
Note: `eligibleCustomerCount` is exported from **both** `orders.server` and
`reminders.server`; routes and cron use the `reminders` one.

**`waha.server.ts`** — `createWahaClient` → `sendText(nomorWa, text)` POSTs
`{baseUrl}/api/sendText` `{session, chatId: "<digits>@c.us", text}` with
`X-Api-Key`, abort on timeout; never throws (returns `{ok, errorMessage}`).
`testWahaConnection` GETs `/api/sessions` (401/403 count as reachable).
**WhatsApp session (FR-32)**: `getWahaSessionView()`, `loginWahaSession()`,
`logoutWahaSession()` — all read the *saved* settings, never throw, and return a
`WahaSessionView` / `WahaSessionResult` that is safe to send to the browser (no API
key). Status comes from `GET /api/sessions?all=true` matched by name (not
`GET /api/sessions/{name}` — see §12); `SCAN_QR_CODE` adds `GET /api/{name}/auth/qr`
(JSON base64, validated: png/jpeg + plain base64 + size cap, because it goes into an
`<img src="data:…">`). Login = create-with-start (`not_created`) / `start` (`STOPPED`) /
`restart` (`FAILED`), a no-op when already running; logout = `POST …/logout`, a no-op
when already logged out. Mutating calls use `max(timeoutMs, 15 s)`. WAHA's JSON
`message` (≤ 200 chars) is surfaced on refusal.

**`waha-session.ts`** — the shared contract for the above: `WAHA_SESSION_STATUSES`,
`WahaSessionState` (`unconfigured|error|rejected|not_created|UNKNOWN` + WAHA's five),
`WahaSessionView`, `WahaSessionResult`, and pure helpers `describeSessionState`
(Indonesian label / tone / hint), `canLogin`, `canLogout`.

**`settings.server.ts`** — WAHA + cron settings over `app_settings`
(DB value beats env `WAHA_BASE_URL/SESSION/API_KEY/TIMEOUT_MS`; timeout clamped
1–60 s), `CRON_PRESETS`, `validateCronExpression`, `recordCronRun`.

**`cron.server.ts`** — in-process `croner` job on `globalThis.__sigulaCron`
(Asia/Jakarta). `ensureCronScheduler` (idempotent), `refreshCronScheduler`
(after saving settings), `runScheduledBatch` (uses the first admin as
`triggeredById`, records ok/skipped/failed), `stopCronSchedulerForTests`.

**`imports.server.ts`** — Excel import. Workbook sheet name = salesman name
(case-insensitive); header row found within first 8 rows by exact titles
`Nama Konsumen`, `Status (Lama/Baru)`, `Tgl Terakhir Order`; rows de-duplicated
by upper-cased name, last wins. `parsePreview` (new / updated / unchanged /
unknown sheets; each row carries its `sheetName`), `confirmImport` (unknown sheets need
`treatUnknownSheetsAsNewSalesman`, else `UnresolvedSheetsError`; new customers
get cycle 30; dates applied through `recordOrder` with `sumber:"import"`),
`buildImportTemplate`. DB match of existing customers is exact `nama` +
salesman. Future dates accepted (DEBT-001).

**`upload.server.ts`** + **`upload.ts`** — the server half of the upload flow
(`UploadDialog` is the client half; `upload.ts` is the shared contract:
`UPLOAD_INTENT` preview/confirm/discard, `UPLOAD_FIELD`, `UploadActionData<P,R>`).
`handleUpload(form, { parse, confirm, maxBytes?, unreadableMessage? })` is called
from a route action and returns `null` for any other intent. It owns the size
check, the in-memory token store (30 min TTL, **single-use**, DEBT-006) and turns
`parse` failures into a message; `UploadError` from `parse`/`confirm` is shown to
the user as-is, anything else from `confirm` propagates (500). A record supplies
only `parse` (file → preview payload, **no writes**) and `confirm` (apply).

**`reports.server.ts`** — three `.xlsx` builders: `buildSalesmanReminderReport`
(notified customers only), `buildSupervisorTeamReport` (subtree; sheets
"Ringkasan Salesman", "Detail Customer"), `buildManagementSummaryReport`
(sheets "Per Supervisor" [direct reports], "Per Salesman", "Alasan").

**`activity.server.ts`** + **`activity-format.ts`** — per-record audit trail.
`logActivity` (skips an `update` with no changes; snapshots actor name),
`diffChanges`, `snapshotChanges`, `listActivityFor(entity,id,limit=30)`,
`listRecentActivity(limit=1000)`. `activity-format` holds the labels
(`ENTITY_LABELS`, `ACTION_LABELS`, `FIELD_LABELS`), `formatValue`, `formatStamp`.
**Logging is manual**: each mutation function calls `logActivity` itself, using
human-readable *names* (not ids) as field values. A new mutation path must do
the same, and any new field needs a `FIELD_LABELS` entry.

## 7. Routes (`app/routes.ts` → file)

| URL | File | Who | What it does |
|---|---|---|---|
| `/` | `home.tsx` | any | redirect to `homeForRole` or `/login` |
| `/login` | `login.tsx` | public | POST username/password/`next`; throttled |
| `/logout` | `logout.tsx` | any | destroys session (GET and POST) |
| `/salesman` | `salesman._index.tsx` | salesman | own **notified** customers, stats, `?q=`; buttons post to the two routes below |
| `/salesman/customers/:id/reason` | `salesman.customers.$id.reason.tsx` | salesman | POST `kode_alasan` 1/2/3 → `submitReason`; 403 if not own customer |
| `/salesman/customers/:id/record-order` | `…record-order.tsx` | salesman | POST → `recordOrder` (today, manual) |
| `/supervisor` | `supervisor._index.tsx` | supervisor | `salesmenWithStats(user.salesmanId)` |
| `/supervisor/salesmen/:id` | `supervisor.salesmen.$id.tsx` | supervisor | customer list; 403 unless in subtree |
| `/supervisor/customers/:id/reactivate` | `…reactivate.tsx` | supervisor | POST → `reactivateCustomer`; subtree-scoped |
| `/management` | `management._index.tsx` | management | `supervisorsWithStats` + reason counts |
| `/admin/dashboard` | `admin.dashboard.tsx` | admin | preview + last 5 batches; intents `trigger`(default) / `retry` / `delete` (`batch_id`) |
| `/admin/reminders` | `admin.reminders.redirect.tsx` | – | redirect → `/admin/dashboard` |
| `/admin/transaksi` | `admin.transaksi.tsx` | admin | Transaksi table + drawer; intents `create` / `update` / `delete_many`; the Excel import (icon left of "+ Tambah transaksi" → `UploadButton`) posts `preview` (multipart `.xlsx` ≤ 10 MB) / `confirm` (`preview_token`, `treat_unknown`) / `discard`, all routed through `handleUpload`. The route holds only the record-specific bits: `describeImportPreview`, `describeImportResult`, and the `parse`/`confirm` callbacks |
| `/admin/transaksi/template.xlsx` | `admin.transaksi.template.tsx` | admin | import template download |
| `/admin/imports` | `admin.imports.redirect.tsx` | – | redirect → `/admin/transaksi` |
| `/admin/masterdata?tab=` | `admin.masterdata.tsx` | admin | 3 tabs × drawer; intents `create_/update_/delete_many_` + `customer`/`salesman`/`user`; errors caught → flash |
| `/admin/audit` | `admin.audit.tsx` | admin | activity feed (filter `entity`, `q`, paging) + last 50 `mutation_logs` + last 50 `status_logs` |
| `/admin/settings?tab=waha\|cron` | `admin.settings.tsx` | admin | sidebar submenu "Koneksi WAHA" (default) / "Jadwal Cron", no in-page tab bar; intents `save_waha` / `test_waha` / `save_cron`; the WAHA tab also mounts `<WahaSessionCard />` |
| `/admin/settings/waha-session` | `admin.settings.waha-session.tsx` | admin | resource route (no page): GET → `{view, error:null}` (status + QR), POST intent `login` / `logout` → `{view, error}`; unknown intent → 400. `Cache-Control: no-store` via **both** `data()` and the `headers` export (the QR is sensitive) |
| `/reports/salesman/:id` | `reports.salesman.$id.tsx` | salesman, admin | `.xlsx`; `me` = own salesman |
| `/reports/supervisor/:id` | `reports.supervisor.$id.tsx` | supervisor, admin | `.xlsx` (id = leading salesman id) |
| `/reports/management` | `reports.management.tsx` | management, admin | `.xlsx` |

Admin is **not** allowed on `/salesman`, `/supervisor`, `/management` pages
(those require their own role); admin only reaches the report downloads.
Sidebar entries per role are the `NAV` map in `AppShell.tsx` — add a nav item
there when adding a page. A `NAV` entry with `children` (`{tab,label}[]`) renders a
submenu, shown only while on that route and keyed by `?tab=`; **the first child is the
default** when `?tab` is absent. Data Master and Pengaturan use it.

The upload preview keeps the uploaded bytes in a module-level `Map` in
`upload.server.ts` (30 min TTL, lost on restart — DEBT-006).

## 8. Domain rules you will trip over

- **Overdue / eligible**: see `dates.ts` / `orders.server.ts` above. `notified`
  means "reminder sent, waiting for the salesman". It is set **only** on a
  confirmed WAHA success for a salesman-kind delivery, and cleared by
  `recordOrder`, `submitReason`, and `deleteBatch`.
- **Reason codes** (`REASON_LABELS` in `schema.ts`): `1` Kalah Harga, `2` Stok
  Masih Ada, `3` Sudah Bangkrut. Changing them touches: `schema.ts`, the CHECK
  in `migrate.server.ts`, `submitReason`, the `["1","2","3"]` loops in
  `salesman._index.tsx`, `management._index.tsx`, `reports.server.ts`.
- **Hierarchy (ADR-0004)**: a supervisor *is* a salesman with subordinates
  (`salesmen.supervisor_id`, any depth, no cycles). "Team" = the whole subtree
  for the supervisor dashboard/export/authorisation; **direct reports only**
  for WhatsApp summaries and management's per-supervisor table (so nothing is
  double counted). A `supervisor` role user links to their salesman row via
  `profiles.salesman_id`.
- **Notifications**: each eligible salesman gets a list message; each *direct*
  supervisor of an eligible salesman gets a count-only summary as a **separate
  delivery** (`recipient_kind='supervisor'`). A supervisor's own overdue
  customers arrive as a normal salesman message. No `nomor_wa` ⇒
  `skipped_no_phone` and `notified` is not flipped (FR-17). WAHA down must not
  break tracking (FR-29).
- **Delete semantics**: hard deletes (DEBT-009). Customer delete cascades its
  transaksi/reason/status/mutation rows. Salesman delete is refused while they
  own customers/transaksi/direct reports. `deleteCustomersMany`,
  `deleteTransaksiMany`, `deleteUsersMany` loop item by item (only
  `deleteSalesmenMany` pre-validates the whole batch).

## 9. Tests (`npm test` — 132 passing in 14 files, run 2026-09-26)

`vitest.config.ts`: `tests/**/*.test.ts`, `setupFiles: tests/setup.ts`, forks,
`maxWorkers: 1`, `~` alias. `setup.ts` points `DATABASE_PATH` at a temp file
**before** any app module opens SQLite — never import `db` in a way that
precedes it.

Pattern: `beforeEach(() => resetDb())`, then `await seedOrg()` (returns
`supervisor` "Budi Supervisor" as the top node, `salesman` "Andi Sales" and
`salesmanB` "Citra Sales" both reporting to that supervisor, `admin`, `salesmanUser`), `addCustomer({...})`,
and `TODAY = "2026-09-12"` passed as `today`. WAHA is faked with a local
`fakeClient()` (`calls[]`, `failFor`, `alwaysFail`) — see `tests/reminders.test.ts`.
**`resetDb()` deletes from the explicit `TABLES` list in `fixtures.ts` — add any
new table there.**

| Area | File |
|---|---|
| BR-1 dates | `dates.test.ts` |
| eligibility, `recordOrder`, `deleteTransaksiMany` | `orders.test.ts` |
| trigger/preview/retry/delete batch, `submitReason` | `reminders.test.ts` |
| reassign, reactivate, stats, bulk deletes | `masterdata.test.ts` |
| hierarchy rules + supervisor notifications | `hierarchy.test.ts` |
| legacy supervisors → salesmen migration | `migrate-supervisors.test.ts` (own in-memory DB) |
| activity log | `activity.test.ts` |
| Excel import | `imports.test.ts` |
| upload flow (token single-use, TTL, discard, size, unreadable) | `upload.test.ts` |
| reports | `reports.test.ts` |
| auth helpers/throttle | `auth.test.ts` |
| WAHA/cron settings, `runScheduledBatch` | `settings.test.ts` |
| WhatsApp session status/login/logout (fake WAHA via stubbed `fetch`) | `waha-session.test.ts` |
| `allowedActionOrigins` config | `csrf-config.test.ts` |

There are **no route/HTTP tests**; loaders/actions/UI are covered only by
manual/Playwright checks recorded in `.agents/work/STATE.md`.

## 10. Config, env, deploy

- `react-router.config.ts`: `ssr: true`; `allowedActionOrigins: ["sigula.ceater.cc", "*.ceater.cc"]`
  (needed because Caddy terminates TLS and the CSRF check compares origins).
- Env: `SESSION_SECRET` (required non-default in prod), `DATABASE_PATH`
  (default `data/sigula.db`), `WAHA_BASE_URL`, `WAHA_SESSION`, `WAHA_API_KEY`,
  `WAHA_TIMEOUT_MS`, `NODE_ENV`, `PORT`. (`.env.example` is unreadable to the
  agent by permission; values above come from the code.)
- `Dockerfile`: 4-stage `node:24-alpine`, `npm run start` on port 3000,
  healthcheck GET `/login`. `docker-compose.yml`: service `app`, container
  `sigula`, `127.0.0.1:3010 → 3000`, volume `sigula-data:/app/data`,
  `WAHA_BASE_URL=http://host.containers.internal:3002`.
- Prod: `https://sigula.ceater.cc` (VPS, podman, Caddy). Runbook:
  `docs/runbook-sigula.md`. **Production is not yet on the ADR-0004 schema** —
  see STATE.md / the runbook's "Upgrade note — ADR-0004".

## 11. Recipes — where to edit for common requests

| Request | Touch |
|---|---|
| Add a field to Customer / Salesman / User | `schema.ts` + `migrate.server.ts` (new install DDL **and** an upgrade step for existing DBs) → the entity's create/update in `masterdata.server.ts` incl. its `*Fields()` helper (feeds the activity log) → `FIELD_LABELS` in `activity-format.ts` → `admin.masterdata.tsx` (search filter, table column, drawer input, action parsing) → tests |
| Add a field to Transaksi | same, but `orders.server.ts` (`transaksiFields`, create/update) and `admin.transaksi.tsx` |
| Add a new admin CRUD table | copy the Transaksi/Data Master pattern: loader (`q`/`paginate`/`parseDrawer`), `useRowSelection` + `BulkActionBar`, `TableToolbar`, `TablePagination`, `<RecordDrawer>` with `remove`; add `ACTIVITY_ENTITIES` value **and** the CHECK list in `migrate.server.ts`; add `OPEN_HREF` entry in `admin.audit.tsx`; add to `TABLES` in `fixtures.ts` |
| Add a page / route | file in `app/routes/`, register in `app/routes.ts`, `requireRole`, nav item in `AppShell.tsx` `NAV`, `homeForRole` if it is a landing page |
| Add an Excel export | builder in `reports.server.ts`, thin loader route like `reports.management.tsx`, register in `routes.ts` |
| Change the overdue rule | only `isOverdue` in `dates.ts` (dashboards, stats, reports all call it) + `dates.test.ts` |
| Change the WhatsApp text | `salesmanMessage` / `supervisorMessage` at the bottom of `reminders.server.ts` |
| Add upload/import to another record | write its `parse` (→ preview, no writes) and `confirm`; in the route's action call `handleUpload(form, { parse, confirm })` and `if (upload) return upload;`; render `<UploadButton>` with `describePreview` / `describeResult` (module-level functions — keep them referentially stable) and a `template` link if there is one. Nothing in `UploadDialog`/`upload.server` needs editing. Only Transaksi uses it today |
| Change import columns/format | `HEADER_*` constants and `sheetRows`/`excelDateToIso` in `imports.server.ts`; `buildImportTemplate` must match |
| Change who sees what | the `requireRole` list in the route + ownership check in that route/action; supervisor scope = `subordinateIds` |
| Change WAHA transport | `waha.server.ts` only (keep the `WahaClient` interface so tests can fake it). Session panel: `waha.server.ts` session functions + `waha-session.ts` (states/labels) + `WahaSessionCard.tsx`; tests stub global `fetch` (see `waha-session.test.ts`) |
| Change scheduling | `cron.server.ts` / `settings.server.ts` / `admin.settings.tsx` (DEBT-010, contradicts ADR-0002) |
| Tweak look & feel | `app.css` (classes above) and the shared bits in `components/` |

## 12. Quirks worth knowing before you edit

- `SESSION_SECRET` guard runs at **module import** in production — a missing
  secret crashes the build/boot (the Dockerfile sets a placeholder for build).
- Drizzle+SQLite mishandles ``sql`(datetime('now'))` `` column defaults on some
  INSERTs (seen on `notification_batches`); `activity.server.ts` and
  `triggerBatch` therefore pass an explicit timestamp. Do the same for new
  timestamp columns.
- `deleteSalesman` also deletes `profiles` rows pointing at that salesman,
  leaving the `users` row without a profile (such a user can no longer resolve
  via `getAuthUser`).
- Loaders load whole tables and filter in JS (`listTransaksi(2000)`,
  `listRecentActivity(2000)`, all customers/salesmen) — fine at pilot scale, not
  beyond it. SQLite write contention is a known pilot limit.
- Login throttle and the upload-preview store are per-process memory.
- A native `<dialog>` is centred by the UA's `margin: auto`, which Tailwind's
  preflight zeroes — `.upload-dialog` sets `margin: auto` itself. Copy that for
  any new `<dialog>`.
- `admin.dashboard.tsx` confirms batch deletion with `window.confirm`; the
  drawer's delete uses an inline confirm instead (avoid modal dialogs).
- **WAHA answers 403 (not 404) for a session that does not exist**
  (`GET /api/sessions/{name}`, WAHA 2026.8.2 CORE) — indistinguishable from a rejected
  key, so session existence is read from the list. The real session on
  `waha.ceater.cc` was named `Sigula` (setting `waha.session` must match it).
- A `fetcher` request to a route goes to `<route>.data` (single fetch), which **ignores
  headers set through `data(…, {headers})`** and honours only the route's `headers`
  export — set both when a header matters (`admin.settings.waha-session.tsx`).
- The session panel has no route/HTTP tests (same as every route); it was verified
  with Playwright against a mock WAHA (STATE.md).
- `reports.server.ts` re-exports `todayIso`; nothing imports it from there
  (checked 2026-09-26) — harmless leftover.

## 13. Debt markers in code

`DEBT-001` future dates on import (`imports.server.ts`) · `DEBT-006` in-memory
upload-preview store (`upload.server.ts`) · `DEBT-009` transaksi not append-only
(`schema.ts`) · `DEBT-010` opt-in cron (`admin.settings.tsx`) · open/closed
list: `.agents/work/DEBT.md`.

## 14. Keeping this file honest

**Rule** (gate `config.yml → overrides.development.codemap_update: required`):
every change to code — `app/`, `tests/`, `Dockerfile`, `docker-compose.yml`,
`package.json`, `react-router.config.ts`, `vite.config.ts`, `vitest.config.ts` —
is checked against this map **in the same change**, and the map is edited
wherever it is now wrong: a file added/removed/renamed, a route, a table or
column, an intent, a public function's contract, a convention, a test file, a
quirk. Always bump **Last synced**, even when nothing else needed editing.

**Enforcement**: a `Stop` hook (`.agents/hooks/codemap-guard.mjs`, registered in
`.agents/settings.json`) refuses to end a turn while an uncommitted code file
is newer than this file. It nudges once per turn (`stop_hook_active` → it only
warns, so it cannot loop), fails open outside a git repo, and follows the gate:
`required` blocks, `recommended` only warns, `skip` turns it off. It compares
file modification times, so it proves the map was touched, not that it is right
— the review is still on whoever made the change.

A stale map is worse than none.
