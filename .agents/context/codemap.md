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
> **Last synced:** 2026-09-27 — branch `feat/erd-v2-foundation`: ERD v2 releases **R1** (ADR-0005: versioned
> migrations, soft delete + "Terhapus", assignment/status history, import batches, ISO timestamps),
> **R3** (ADR-0006: runs/deliveries/items, derived "pending", void, templates, contacts, follow-ups) and
> **R2** (ADR-0007: RBAC — roles, permissions with scope, many roles per user; `profiles` is gone).
> Delivery check + test message (2026-09-27, FR-48/FR-49): WAHA answers `sendText` 201 before WhatsApp accepts the message, so `WahaClient.sendText` now asks WhatsApp's verdict (`GET /api/{session}/chats/{chat}/messages/{id}` → `ack`; -1 = refused ⇒ `ok:false` with the reason, incl. the reachout timelock read from `me.reachoutTimelock`; pending is waited for ≤ `ackWaitMs` 4 s; anything unknown counts as sent); `WahaSessionView.restriction` + a warning in `WahaSessionCard`; `sendTestMessage` in `reminders.server.ts` and the salesman panel's ⋮ → "Kirim pesan tes" (intent `send_test_message`, `notification.manage`, activity key `pesan_tes_dikirim`). Earlier: WhatsApp numbers (hotfix): `whatsapp-number.ts` — `normalizeWhatsappNumber` ("0812…"/"+62 812…"/"812…" → `62812…`) and `isPlausibleWhatsappNumber`; used by `waha.server.ts` `chatId` (a chat id like `0812…@c.us` made WAHA answer 500 in production), by `salesmanIdByWhatsapp` (a reply is matched whichever way the number was saved), and before every send (an implausible number is skipped/refused with its value); `sendText` failures now carry WAHA's own explanation (160 chars). Earlier: "Kirim pengingat kembali" (FR-46): `resendReminder` in `reminders.server.ts`, ⋮ menu item via `RecordDrawer`'s new `actions` prop, intent `resend_reminder` in `admin.masterdata.tsx`; `pending.server.ts` now lets only a customer's newest reminder decide. Earlier: Review + production prep (2026-09-26): no default credentials in production (`seedDatabase`, login hint hidden in a production build, password policy `assertPasswordAcceptable`), `root.tsx` headers, GET `/logout` no longer logs out, webhook body cap / no stranger text / bounded `inbound_messages`, free-text and quoted replies (`reasons.ts`, migrations 0008–0009), reminder text v3; open findings are DEBT-019…025. Earlier: WhatsApp replies (ADR-0009): `POST /webhooks/waha` → `inbound.server.ts` / `reply-parser.ts`, table `inbound_messages` + `notification_items.position` (migration 0007), secret `waha.webhook_secret` (Pengaturan → Koneksi WAHA), Log Audit "Balasan WhatsApp"; `submitReason` takes `actingUserId: number | null` and `via`; `templates.server.ts` has `orderByWait` (one ordering for the message and the stored positions). Earlier: Admin dashboard reworded and paged: Indonesian copy throughout ("Perlu diingatkan" for eligible, "pengiriman" for batch), the history is paged 5 per page via `runsPage` + `TablePagination` (`?page=`), delivery statuses are labelled, and a run that delivered any message can no longer be voided (`voidBatch` refuses it; the dashboard hides the button). Dashboards reviewed: `StatTile` follows the design system's KPI tile (dot + uppercase label above the number; the tone colours the dot). Comments + reasons + paging + message v2 (ADR-0008): `record_comments` (migration 0005), "Aktivitas & komentar" feed with a composer on every record panel (`ActivityFeed.tsx`, `/comments`, `comments.server.ts`), reasons are given from the customer panel (dashboard reason buttons and `/salesman/customers/:id/reason` are gone), Log Audit and feeds paged in SQL (`pagination.ts`; `TablePagination` takes `pageParam`), reminder text v2 (migration 0006; `tanggal`/`daftar_alasan`, numbered `daftar_customer`). Earlier: customer edit panel — ⤢ now means full page, Status is a `ToggleField` at the top, last transaksi date + order status (Overdue / On track, `orderStanding`) shown read-only there and as list columns; every follow-up reason is logged in the activity log (`submitReason`). Earlier: the Aktif/Terhapus switch moved into the list search bar (`TableSearch.tsx`, replaces `TrashSwitch` + the old `TableToolbar`); transaksi keeps soft delete (decision). Fix: migrations now run when the database is opened, not from the root loader (see §5 Bootstrap timing). DEBT markers added in `masterdata.server.ts` / `roles.server.ts` / `access.server.ts` (DEBT-017/018). Cleanup pass: unused and
> duplicate code removed (shared `names.server.ts`, `listLive*` / `liveCustomersOf`, reports reuse `salesmenWithStats`). `Tx` is now private to `client.server.ts`; use `DbHandle`. *Update this line on every code change, even when no other
> section needed editing — it is the record that the review happened.*
>
> Business rules and requirement IDs (FR-/BR-) live in `docs/frd/`. Design
> decisions live in `docs/adr/`. This file is only *where things are and how
> they fit*.

## 1. What it is

SiGula — a React Router 7 (framework mode, SSR) monolith on Node 22+. It tracks
each customer's reorder cycle, flags overdue accounts, and sends WhatsApp
nudges (via WAHA) to salesmen and their supervisors. Access is RBAC (ADR-0007): a user holds
roles; built-in roles `admin`, `salesman`, `supervisor`, `management` are bundles of permissions. SQLite via Drizzle + better-sqlite3.
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
  root.tsx                 HTML shell + ErrorBoundary; root loader = DB bootstrap + cron start; `headers` = security headers on every page
                           (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS in production; no CSP — DEBT-019)
  routes.ts                EXPLICIT route table (not file-based) — every route is registered here
  app.css                  Tailwind 4 import + `--sg-*` tokens + all custom classes (BEM-ish)
  components/
    AppShell.tsx           AppShell (sidebar/topbar, NAV built from the user's permissions), PageHeader, StatTile, StatusPill
    DataTable.tsx          paginate, resolvePageSize, useRowSelection, TablePagination, BulkActionBar
                           (variant delete | restore), SelectAllCheckbox
    RecordDrawer.tsx       URL-driven side drawer: parseDrawer, useDrawerHref, RecordDrawer (⤢ button =
                           "full page": 100vw, no scrim, fields in two columns, Aktivitas as a side column;
                           `.drawer--full`, state is local), ReadonlyField, EditLink, AddLink, useRowOpen
                           (+ activity timeline); the ⋮ menu takes `actions` (`DrawerAction`: label, fields to post,
                           a confirm question, optional `disabledReason`) next to Salin tautan / Hapus
    ToggleField.tsx        design-system toggle (`role="switch"`) for a two-state form field; submits its
                           value via a hidden input, saved with the form's own button (Customer → Status)
    TemplateEditor.tsx     one editable message template card (Pengaturan → Template Pesan) + live preview
    TableSearch.tsx        TableToolbar: the list search bar after the design system — one bordered box with
                           the icon, the status filter as a chip ("Status adalah Terhapus ×"), the text input
                           and "Bersihkan", plus a suggestion list (pick a column → pick Aktif/Terhapus, or
                           Enter to search every column). State is the URL (`q`, `trash`, `pageSize`, `tab`);
                           `statusFilter` is optional (Audit log has none). Exports StatusFilter
    TrashTable.tsx         "Terhapus" view: read-only rows + Pulihkan (row and bulk)
    UploadDialog.tsx       record-agnostic upload modal: UploadButton (icon + native <dialog>,
                           drop/pick → preview → confirm/cancel), UploadPreviewView type
    WahaSessionCard.tsx    "Sesi WhatsApp" panel on Pengaturan → Koneksi WAHA: status pill, QR,
                           Login / Logout (inline confirm), a warning while WhatsApp restricts the
                           account (`view.restriction`); polls the resource route every 4 s
  db/
    schema.ts              Drizzle tables (source of truth), enum lists + `oneOf` CHECK helper, `alive()`
    client.server.ts       opens SQLite (WAL, foreign_keys ON) **and migrates it on open** (`migrateDatabase`), so the
                           schema is current before any query; exports `db`, `sqlite`, `DB_PATH`, and the type
                           `DbHandle` (`db` or an open transaction) for helpers that work in both
    migrate.server.ts      `migrateDatabase(dbh)` = frozen ADR-0004 baseline (only on a DB with no recorded migration)
                           + runMigrations; also migrateLegacySupervisors. Does not import client.server (no cycle)
    migrations.server.ts   runMigrations: applies drizzle/*.sql, foreign_keys OFF, 1 txn per migration,
                           foreign_key_check before commit; PREFLIGHT checks per tag
    seed.server.ts         seedIfEmpty(): on an empty `users` table — outside production the demo org (four accounts, published password);
                           **in production no demo accounts ever**: one administrator from `ADMIN_PASSWORD` (+ optional `ADMIN_USERNAME`), none
                           without it (`seedDatabase({production,…})` is the testable core)
  lib/                     business logic — one module per ownership area (see §6)
    auth.server.ts  masterdata.server.ts  orders.server.ts  reminders.server.ts
    imports.server.ts  reports.server.ts  activity.server.ts  settings.server.ts
    cron.server.ts  waha.server.ts  upload.server.ts
    customer-history.server.ts  trash.server.ts  contacts.server.ts  pending.server.ts
    follow-ups.server.ts  templates.server.ts  roles.server.ts  access.server.ts  inbound.server.ts
    names.server.ts  comments.server.ts  permissions.ts  activity-entities.ts
    dates.ts  activity-format.ts  pagination.ts  reply-parser.ts  whatsapp-number.ts  upload.ts  template-vars.ts
    dates.ts  activity-format.ts  upload.ts  waha-session.ts   (no `.server` → safe to import in components)
  routes/                  one file per route: loader/action + page component
tests/
  setup.ts                 sets DATABASE_PATH (temp dir) + SESSION_SECRET BEFORE app modules load
  helpers/fixtures.ts      resetDb, seedOrg, addCustomer, getCustomer, voidRunLegacy, TODAY
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
  `const user = await requirePermission(request, PERM.settingsManage)` (`PERM` from `~/lib/permissions`).
  Missing permission → `Response("Forbidden", 403)`; no session → redirect `/login?next=…`.
  Row-level checks use the permission's *scope* via `access.server.ts`: `assertOwnOrAll(user, PERM.x,
  salesmanId)` (all → any salesman, else only the user's own; `canOwnOrAll` is the boolean form) and `assertInTeamOrAll` (team → subordinates
  only, not oneself); `requireSalesmanId(user)` refuses a user with no linked salesman (never read that as
  "everyone"). Other lookups throw 403/404 `Response`s in the route.
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
  `.drawer*`, `.upload-dialog*`, `.dropzone*`, `.btn-icon`, `.activity-list*`, `.table-toolbar`,
  `.search-wrap/.search-bar*/.search-chip*/.search-suggest*/.search-echo` (list search bar), `.toggle-field*`, `.drawer--full`, `.bulk-bar`,
  `.table-pagination`, `.page-btn`, `.login-*`, `.action-row`, `.hide-sm`).
  Palette tokens `--sg-*` (teal brand, slate neutrals). Light theme only.
- **Comments** are sparse; they carry BR/FR/ADR/DEBT ids (`// DEBT-009`).
  Every shortcut needs a `DEBT-NNN` marker + a row in `.agents/work/DEBT.md`.

## 5. Database (`app/db/schema.ts` is the source of truth; the SQL that builds it is `drizzle/*.sql`)

| Table | Key columns / constraints |
|---|---|
| `users` | id, `username` (unique among live rows), `password_hash` (bcrypt), `display_name`, **`salesman_id`** (the salesman this login acts as; needed by roles with `own`/`team` permissions — enforced in the app, not the DB), **`is_active`** (false = cannot sign in), **`last_login_at`**, timestamps + `deleted_at` |
| `roles` | `code` (admin, salesman, supervisor, management), `name`, `description`, `is_system`. Reference data seeded by migration 0004; no editor |
| `permissions` | `code` (the same 13 codes as `PERM` in `app/lib/permissions.ts` — a test keeps them equal), `description` |
| `role_permissions` | (`role_id`, `permission_id`) PK + `scope` own/team/all |
| `user_roles` | (`user_id`, `role_id`) PK, `granted_at`, `granted_by_id`. A user may hold several roles; permissions merge, widest scope wins |
| `salesmen` | `nama`, **`supervisor_id` → salesmen (self-FK)**, `status`, timestamps + `deleted_at`. CHECK `supervisor_id <> id`; index on supervisor_id. The WhatsApp number is **not** here any more → `salesman_contacts` |
| `salesman_contacts` | `salesman_id`, `channel` (whatsapp/email/sms/push), `address`, `is_primary`, `is_verified`, timestamps + `deleted_at`. One live primary per (salesman, channel). Only WhatsApp is written/sent today (DEBT-014) |
| `customers` | `nama`, `salesman_id` (CACHE of the open assignment), `tipe_customer`, `order_cycle_days` (CHECK ≥ 1), `status_customer`, `last_order_date` (CACHE of max live tanggal_order), timestamps + `deleted_at`. UNIQUE(`lower(nama)`,`salesman_id`) among live rows (expression index made by hand in 0001 — drizzle-kit cannot express it) |
| `transaksi` | `customer_id`, `salesman_id` (snapshot), `tanggal_order`, `sumber`, `import_batch_id`, `catatan`, `created_at/by`, `updated_at/by`, `deleted_at/by`, **`deleted_with_customer_id`** (set when it went to the trash with its customer). `tanggal_input` is gone (= `created_at`). Editable, soft-deleted (DEBT-009). `orderHistory` is a deprecated alias |
| `follow_up_reasons` | lookup: `code` ("1" Kalah Harga, "2" Stok Masih Ada, "3" Sudah Bangkrut), `label`, `deactivates_customer`, `sort_order`, `is_active`. Seeded by migration 0003, plus `other` / "Lainnya" (migration 0009): what a free-text answer is recorded as — never offered, never deactivates; `listFollowUpReasons` filters it out, `reasonCounts` shows it |
| `follow_ups` | replaces `reason_logs` + `customers.handled_on`: `customer_id`, `salesman_id`, `notification_item_id` (the reminder it answers; unique), `outcome` (will_order/not_ordering/unreachable), `reason_id` (required for not_ordering), `follow_up_date`, `created_by_id`. Immutable |
| `notification_runs` | replaces `notification_batches` (ids kept): `trigger` manual/scheduled, `triggered_by_id` (null = scheduler), `as_of_date`, `started_at`, `finished_at`, **`voided_at/by/reason`** |
| `message_templates` | `code` (reminder_salesman / reminder_supervisor), `channel`, `recipient_kind`, `subject` (email), `body` with `{{nama}}`/`{{jumlah}}`/`{{tanggal}}`/`{{daftar_customer}}`/`{{daftar_alasan}}`, `version`, `is_active`. Edit = new version. Seeded (whatsapp + email; email hidden); migration 0006 makes v2 the active salesman WhatsApp text where v1 was untouched |
| `notification_deliveries` | one message: `run_id`, `salesman_id` (the *recipient*), `recipient_kind`, `channel`, `contact_id`, `address` + `message_body` + `template_id` (snapshots), `customer_count`, `status` queued/sent/failed/skipped_no_contact, `provider_message_id`, `error_message`, `attempt` (a retry is a new row), `sent_at` |
| `notification_items` | which customers a message covered: `delivery_id`, `customer_id`, `last_order_date` + `days_overdue` (snapshots), **`position`** (the line number in the message; a reply's "3" means this row; null for messages sent before ADR-0009); unique (delivery, customer) |
| `customer_assignments` | replaces `mutation_logs`: `customer_id`, `salesman_id`, `valid_from`, `valid_to` (null = current), `assigned_by_id`, `note`. One open row per customer (partial unique). Immutable except `valid_to` set once |
| `customer_status_history` | replaces `status_logs`: `from_status`, `to_status`, `reason` (manual_inactive / manual_reactivation / auto_reactivation), `changed_by_id` (null = system), `changed_at`. Only real transitions |
| `import_batches` | one Excel import: `file_name`, `file_sha256`, `row_count`, `imported_by_id`, `imported_at`; `transaksi.import_batch_id` points here |
| `activity_logs` | `entity_type` (free text, no CHECK), `entity_id`, `entity_label` + `actor_name` (snapshots), `action` create/update/delete/**restore**, `changes` JSON, `created_at` ISO; indexes (entity_type, entity_id, id) and (actor_id, created_at); `actor_id` SET NULL |
| `inbound_messages` | a WhatsApp message from the WAHA webhook (ADR-0009): `provider_message_id` (unique = exactly once), `session`, `from_address` (digits), `salesman_id` (null = stranger), `body` ("" for a stranger: their text is never kept), `reply_to` (the quoted message id as WAHA sent it, migration 0008), `outcome` recorded/unrecognized/nothing_pending/unknown_sender (CHECK), `detail`, `reply_text`, `reply_status` none/sent/failed (CHECK), `received_at`, `created_at` |
| `record_comments` | messages on a record's panel: `entity_type` (transaksi/customer/salesman/user, no CHECK), `entity_id` (no FK), `body` (CHECK not empty; ≤2000 in app), `author_id` (set null) + `author_name` snapshot, `created_at`; index (entity_type, entity_id, id). Never edited or deleted |
| `app_settings` | key/value store + `is_secret`, `updated_at`, `updated_by_id`: `waha.{base_url,session,api_key,timeout_ms,webhook_secret}` (api_key and webhook_secret are secrets), `cron.{enabled,expression,last_run_at,last_run_status,last_run_message}` |

**Schema source of truth is `schema.ts`.** Change it, then `npm run db:generate` (drizzle-kit
writes `drizzle/NNNN_*.sql` + snapshot; it needs a TTY for rename prompts — answer "create").
Hand-edit the SQL when data must be backfilled/converted (see 0001). `npm run db:check`
validates the snapshot chain. `migrate.server.ts` holds the **frozen** ADR-0004 baseline DDL; never
add to it. **Conventions** (ERD v2): enums = TEXT + CHECK (`oneOf` helper), timestamps = ISO-8601
UTC `YYYY-MM-DDTHH:MM:SSZ` filled by the app (`nowIso()`, `$defaultFn`/`$onUpdate` — no DB default),
master data soft-deleted (`deleted_at`; read through `alive(table)`), logs immutable.
`tests/migrations.test.ts` checks the migrated DB against `schema.ts` (columns, NOT NULL, PK, FKs, indexes).
Migrating **production** is ask-first and needs a file backup; the `drizzle/` folder must be in the image
(Dockerfile copies it). A rebuilt table must carry its `sqlite_sequence` counter (0001 does).

**Bootstrap timing**: the schema is migrated **when the database is opened** — the first import of
`client.server.ts` (server start in production, first request in dev) — never from a route, because a first
request can skip the root loader (a client-side navigation in a tab that outlived a server restart; resource routes)
and would then query the old schema (`no such column: users.salesman_id`). A failing migration throws there, so the
server does not come up on a schema it cannot use. `npm run build` does not open the database. The root loader
still calls `seedIfEmpty()` (demo seed if `users` is empty, memoised promise, `BEGIN IMMEDIATE`) and
`ensureCronScheduler()` on page requests.

## 6. `app/lib` — who owns what (public functions)

**`auth.server.ts`** — cookie session `__sigula_session` (12 h, httpOnly, secure
in prod; **throws at import in production if `SESSION_SECRET` is unset/default**).
`getAuthUser` (live + `is_active` user whose linked salesman, if any, is live; loads role names and the merged
`permissions` map — 2 queries per request), `requireUser`, **`requirePermission`**, `createUserSession`,
`destroyUserSession`, `verifyLogin`, `recordLogin` (sets `last_login_at`), `hashPassword`, in-memory
login throttle (`checkLoginThrottle` / `recordLoginFailure` / `clearLoginFailures`, 10 tries / 15 min per
`x-forwarded-for:username`). `AuthUser = Access & {id, username, displayName, roleNames}`; `Access = {permissions,
salesmanId}`.

**`permissions.ts`** (client-safe) — `PERM` (the 13 codes), `Scope`, `can`, `scopeOf`, `mergeGrants`, `homeFor`
(admin dashboard → management → team → salesman; null = nothing to open, `/` answers 403). **`roles.server.ts`** —
`listRoles`, `roleIdsByCode`, `rolesNeedingSalesman` (a role needs a salesman iff it has an `own`/`team`
permission), `rolesForUsers`, `roleNamesOf`, `setUserRoles`, `assertAdministrationRemains` (the last live active
holder of `masterdata.manage` cannot lose it / be deactivated / deleted). **`access.server.ts`** — see §4.

**`dates.ts`** — `todayIso`, `daysBetween`, `parseIsoDate`, `daysSinceOrder`,
**`isOverdue`** (BR-1: never ordered ⇒ overdue; `days > cycle`, equal is *not*
overdue), **`orderStanding`** (`daysSinceOrder` + `overdue` for list/drawer display). Overdue is computed at
read time everywhere, never stored.

**`orders.server.ts`** — `computeEligibleCustomers` (BR-2: `aktif` + overdue),
`notYetNotifiedEligible` (FR-3: also not *pending*),
`syncCustomerLastOrderDate`, **`recordOrder`** (one transaction: insert
transaksi, `last_order_date = max(tanggal_order)`, force `aktif`, `auto_reactivation` status history row if it was inactive; then
logs activity), `listTransaksi`, `createTransaksi` (wraps `recordOrder`),
`updateTransaksi`, `deleteTransaksi`, `deleteTransaksiMany` (loop, not one tx).

**`masterdata.server.ts`** — `assertPasswordAcceptable` (≥ 8 characters, not the published demo password; used by user create/update and the production first-admin seed) and the "live rows" lookups every module reuses: `findLiveCustomer`, `findLiveSalesman`,
`listLiveSalesmen`, `listLiveCustomers`, `liveCustomersOf(salesmanId)`; hierarchy: `subordinateIds` (whole subtree, BFS),
`directReportIds`, `assertValidSupervisor` (rejects unknown/self/cycle).
Customers: `createCustomer`, `updateCustomer` (a salesman change delegates to
`reassignCustomer`, which writes `mutation_logs`), `reactivateCustomer`
(`manual_reactivation`), `deleteCustomerRecord` (**soft**: also soft-deletes its live transaksi with `deleted_with_customer_id`; history rows stay), `deleteCustomersMany`, `clampCycleDays` (BR-6).
Salesmen: `createSalesman`, `updateSalesman`, `deleteSalesman` (blocked by
customers / transaksi / remaining direct reports), `deleteSalesmenMany` (**all-or-nothing**, children first).
Users: `createUserAccount({roles: codes[], salesmanId?, isActive?})` (needs ≥ 1 role; a salesman when a chosen role
needs one, otherwise the link is dropped), `updateUserAccount` (password only logged as "(diubah)"; roles diffed
and logged by name), `loadUser`, `deleteUserAccount`, `deleteUsersMany` (refuses the actor's own id).
Stats: `salesmenWithStats(supervisorId?)` (subtree, excludes supervisor),
`supervisorsWithStats()` (management: **direct reports only** — a partition).

**`customer-history.server.ts`** — append-only customer history (ERD D7): `openAssignment`,
`moveAssignment` (closes the open row, opens the next at the same instant), `listAssignmentMovesPage` (a move =
an assignment that took over from an earlier one; paged in SQL), `recordStatusChange`, `listStatusChangesPage`. Write it in the same transaction as
`customers.salesman_id` / `status_customer` (the cache columns). Rows are created only via
`insertCustomer` (masterdata) so every customer has an open assignment.

**`trash.server.ts`** — "Terhapus" views and restore. `listDeleted{Transaksi,Customers,Salesmen,Users}`,
`countDeleted`, `restore{Transaksi,Customer,Salesman,User}` and `restore*Many` (all-or-nothing, salesmen
supervisors-first). A restore refuses, with a message, when it would leave a live row pointing at a deleted
one (customer→salesman, transaksi→customer/salesman, salesman→supervisor) or a taken name/username.
`restoreCustomer` also brings back transaksi with `deleted_with_customer_id = id`.

**`reminders.server.ts`** — the reminder job (ADR-0006). `previewBatch` (per-salesman groups + per *direct*
supervisor groups, each recipient with `nomorWa`), `triggerBatch({triggeredById|null, client?, today?})` (null if
nobody eligible and nothing written; creates a **run**; per recipient×channel a **delivery** written `queued`
*before* sending, items for the customers covered, then `sent`/`failed`; no contact ⇒ `skipped_no_contact`),
**`sendTestMessage({salesmanId, sentById, client?, now?})`** (Admin's "Kirim pesan tes" on a salesman: one short fixed text — not a template, not a reminder: no run, no delivery, nothing pending — to the salesman's WhatsApp number; refuses unknown/deleted salesman, no or implausible number, and a second one within `TEST_MESSAGE_COOLDOWN_SECONDS` (60) of a sent one; a refused message throws with WhatsApp's reason and is not logged; a sent one is logged on the salesman as `pesan_tes_dikirim`),
**`resendReminder({customerId, triggeredById, client?, today?, now?})`** (Admin's "Kirim pengingat kembali": one customer, a list of one, to its salesman only, a run of its own; refuses inactive / not overdue / salesman without a number / reminded within `RESEND_COOLDOWN_MINUTES` (10) before writing anything; a failed send voids the run and throws; a sent one is logged on the customer as `pengingat_dikirim`), `retryBatch` (each recipient's latest failed attempt is re-sent as a **new** delivery `attempt+1`, lists
recomputed once per pass; refuses a voided run), `voidBatch` (cancels a run that delivered **nothing** — every message failed or was skipped — so it is no longer retried; it throws for a run with any `sent` delivery, or one already voided; the run stays on record. Runs voided under the *old* rule, when a sent run could be voided, still free their customers: `pending.server.ts` ignores voided runs),
`runsPage(page, pageSize = RUNS_PAGE_SIZE)` (dashboard history: newest first, paged in SQL with `pageWindow`, each run with its deliveries, recipient names and `needsRetry`; returns `{rows,total,page,totalPages,pageSize}`), `eligibleCustomerCount` (dashboard + cron; the only copy). `ACTIVE_CHANNELS = ["whatsapp"]`. `WahaClient` is injectable (`opts.client`) — tests
pass a fake.

**`pending.server.ts`** — "pending" (was `customers.notified`) is **derived**: `pendingCustomerIds()` /
`pendingItemId` (both built on one shared SQL fragment; tests use `isPending` from `tests/helpers/fixtures.ts`). Pending ⇔ an item on a *sent*, `salesman`-kind delivery of a non-voided run, no
`follow_ups` row on that item, `customers.last_order_date` still equal to the item's snapshot, **and it is the customer's newest such item** (a reminder sent again supersedes the earlier one, so answering the newest ends the wait); live customers
only. One SQL query; callers filter in JS.

**`follow-ups.server.ts`** — `listFollowUpReasons` (the offered reasons, not `other`), `findFollowUpReason`, **`submitReason`** (`note`: the words for `other`, a remark for an offered one; inserts a
`follow_ups` row linked to the customer's pending item; a reason with `deactivates_customer` also marks it inactive +
status history when it really changes; **every** reason is written to the activity log on the customer as an
`update` with `alasan_keterlambatan: — → <reason label or the free text> [(via WhatsApp)]`, plus `status_customer` in the same entry when it deactivated), `reasonCounts`, `followUpCountBySalesman`. DEBT-015: only `not_ordering`.

**`contacts.server.ts`** — `primaryContact`, `whatsappNumber`, `setWhatsappNumber` (blank ⇒ soft-delete; a new
number resets `is_verified`), `attachWhatsapp(rows)` (adds `nomorWa`, one query). The salesman form's "Nomor WA"
field and every `nomorWa` read go through it.

**`templates.server.ts`** (+ `template-vars.ts`) — `renderTemplate`, `unknownPlaceholders`, `customerLines` (the numbered
`{{daftar_customer}}`: longest wait first, never-ordered first, ties by name), `SAMPLE_VARS`, `activeTemplate`,
`listEditableTemplates` (whatsapp only, `EDITABLE_TEMPLATE_CHANNELS`, DEBT-014),
`saveTemplateVersion` (validates, inserts v+1, retires v, logs activity entity `template`; same text = no-op).

**`waha.server.ts`** — `createWahaClient` → `sendText(nomorWa, text)` POSTs
`{baseUrl}/api/sendText` `{session, chatId: "<digits>@c.us", text}` with
`X-Api-Key`, abort on timeout; never throws (returns `{ok, errorMessage}`).
**Delivery check**: 201 only means WAHA handed the message to WhatsApp, so a send with a
message id then looks the message up (`GET /api/{session}/chats/{chat from the id}/messages/{id}`)
and reads `ack` — `-1` ⇒ `{ok:false, errorMessage, messageId}` (`refusalMessage`: the reachout-timelock
text with the end time in WIB when `GET /api/sessions/{session}` → `me.reachoutTimelock.isActive`,
else the general "status ERROR" text), `0` ⇒ look again every 500 ms until `ackWaitMs`
(override, default 4000; 0 = look once), `≥1` ⇒ sent; a lookup that fails or has no `ack` counts
as sent (never failed on a guess). `testWahaConnection` GETs `/api/sessions` (401/403 count as reachable).
**WhatsApp session (FR-32)**: `getWahaSessionView()`, `loginWahaSession()`,
`logoutWahaSession()` — all read the *saved* settings, never throw, and return a
`WahaSessionView` / `WahaSessionResult` that is safe to send to the browser (no API
key). Status comes from `GET /api/sessions?all=true` matched by name (not
`GET /api/sessions/{name}` — see §12); `SCAN_QR_CODE` adds `GET /api/{name}/auth/qr`
(JSON base64, validated: png/jpeg + plain base64 + size cap, because it goes into an
`<img src="data:…">`). Login = create-with-start (`not_created`) / `start` (`STOPPED`) /
`restart` (`FAILED`), a no-op when already running; logout = `POST …/logout`, a no-op
when already logged out. Mutating calls use `max(timeoutMs, 15 s)`. WAHA's JSON
`message` (≤ 200 chars) is surfaced on refusal. While `WORKING` the view also carries
`restriction` (`{until}` from `me.reachoutTimelock`, taken from the list entry or, when the
list leaves it out, from `GET /api/sessions/{name}`; an ended one is null).

**`waha-session.ts`** — the shared contract for the above: `WAHA_SESSION_STATUSES`,
`WahaSessionState` (`unconfigured|error|rejected|not_created|UNKNOWN` + WAHA's five),
`WahaSessionView` (incl. `restriction`), `WahaSessionResult`, and pure helpers `describeSessionState`
(Indonesian label / tone / hint), `canLogin`, `canLogout`.

**`settings.server.ts`** — WAHA + cron settings over `app_settings`
(DB value beats env `WAHA_BASE_URL/SESSION/API_KEY/TIMEOUT_MS`; timeout clamped
1–60 s), `CRON_PRESETS`, `validateCronExpression`, `recordCronRun`.

**`cron.server.ts`** — in-process `croner` job on `globalThis.__sigulaCron`
(Asia/Jakarta). `ensureCronScheduler` (idempotent), `refreshCronScheduler`
(after saving settings), `runScheduledBatch` (`triggeredById: null` ⇒ run `trigger=scheduled`; records ok/skipped/failed), `stopCronSchedulerForTests`.

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

**`reports.server.ts`** — three `.xlsx` builders (all counts come from `salesmenWithStats`, one definition of aktif / inactive / follow-up / pending): `buildSalesmanReminderReport`
(pending customers only), `buildSupervisorTeamReport` (subtree; sheets
"Ringkasan Salesman", "Detail Customer"), `buildManagementSummaryReport`
(sheets "Per Supervisor" [direct reports], "Per Salesman", "Alasan").

**`activity.server.ts`** + **`activity-format.ts`** — per-record audit trail and comments.
`logActivity` (skips an `update` with no changes; snapshots actor name),
`diffChanges`, `snapshotChanges`, `addComment` / `normalizeComment` (2,000-char limit), **`listFeedFor(entity,id,page,
size=10)`** (a record's log entries + comments, newest first, paged in SQL by a UNION of both tables' keys; within one
second a comment sorts before the log entry) and **`listActivityPage({entity,q,page,pageSize})`** (Log Audit: filter and
search in SQL, `json_each` over `changes`, matching the Indonesian labels the page shows; `%`/`_` are literal).
`activity-format` holds the labels (`ENTITY_LABELS`, `ACTION_LABELS`, `FIELD_LABELS`), `formatValue`, `formatStamp`,
`initials`, the feed types (`FeedEntry`, `FeedPage`, `CommentItem`), `COMMENT_MAX_LENGTH`, `FEED_PAGE_PARAM`
(`activityPage`). **`pagination.ts`** — `pageWindow(total,page,size)` (clamps a stale page), `parsePage`.

**`inbound.server.ts`** + **`reply-parser.ts`** — WhatsApp replies (ADR-0009). `verifyWebhookSignature`
(HMAC-SHA512 of the raw body, hex or base64, timing-safe), `handleWahaEvent` (only a text `message` on the configured
session, not `fromMe`, from `@c.us` or a resolvable `@lid`; ignores everything else; sends the confirmation with
`WahaClient`), **`receiveReply`** (one synchronous step: duplicate check by WhatsApp id → sender = salesman by
`salesmanIdByWhatsapp` → `pickDelivery` (quoted, else newest with someone waiting, else newest; sent salesman
deliveries only) → `parseReply` → targets by `notification_items.position` (unnumbered = every customer of that
reminder still waiting) → `submitReason(via "WhatsApp")` per customer, note → comment → the `inbound_messages` row),
`composeConfirmation`, `composeHelp`, `listInboundPage`. **Free text**: after a number, or anywhere in a message that quotes the
reminder (`quoted` = `replyTo` matched a sent message; `detail` says "membalas pengiriman #N" / "mengutip pesan lain"), the words are
the reason (`OTHER_REASON_CODE`, `reasons.ts`); without either they are chatter. **Limits**: a stranger's text is never stored and only the
latest 200 such rows are kept, a salesman's rows 180 days (`prune`), text is cut at 2,000 characters; help replies at most one per hour
per salesman. `reply-parser.ts` is pure: `parseReply(body, reasons, {quoted})` → entries `{numbers|null, reasonCode, note}` + unrecognized lines.

**`comments.server.ts`** — the composer's rules for every record panel: `assertCanUseThread` (whoever manages that
record kind — `transaksi.manage` / `masterdata.manage` — and, for a customer, its own salesman via
`customer.follow_up`; 403/404 `Response`s) and **`postNote`** (comment and/or, on a customer, a reason: validates the
text first, then `submitReason`, then `addComment`; a reason needs `customer.follow_up` for that customer's salesman —
the admin role has none). `isCommentEntity`.
**Logging is manual**: each mutation function calls `logActivity` itself, using
human-readable *names* (not ids) as field values. A new mutation path must do
the same, and any new field needs a `FIELD_LABELS` entry.

## 7. Routes (`app/routes.ts` → file)

| URL | File | Who | What it does |
|---|---|---|---|
| `/` | `home.tsx` | any | redirect to `homeFor(user)` (permissions.ts) or `/login`; a signed-in user with no permission gets 403 |
| `/login` | `login.tsx` | public | POST username/password/`next`; throttled |
| `/logout` | `logout.tsx` | any | POST destroys the session; a GET only redirects to `/` (a link cannot log anyone out) |
| `/salesman` | `salesman._index.tsx` | `customer.follow_up` | own **pending** customers, stats, `?q=`; **no reason buttons** — a row (or "Alasan & aktivitas") opens the customer's view-only panel (`?edit=<id>`, own customers only) with the composer + reasons for a late customer; "Catat Order" posts to the route below |
| `/webhooks/waha` | `webhooks.waha.tsx` | none; HMAC (`X-Webhook-Hmac`) checked **only when** `waha.webhook_secret` is set (optional, as in WAHA; with none the call is taken on trust) | POST from WAHA → `handleWahaEvent`; 401 bad/missing signature (secret set), 400 not JSON, else 200 with the outcome (WAHA retries non-2xx; a retry is a no-op) |
| `/comments` | `comments.tsx` | any signed-in user; access per record in `postNote` | POST `entity_type`, `entity_id`, `body`, optional `kode_alasan`; returns `{ok}` / 400 `{ok:false,error}`; 403/404 for access. Every panel's composer posts here with a fetcher |
| `/salesman/customers/:id/record-order` | `…record-order.tsx` | `customer.follow_up` (own) | POST → `recordOrder` (today, manual) |
| `/supervisor` | `supervisor._index.tsx` | `team.read` | `salesmenWithStats(requireSalesmanId(user))` |
| `/supervisor/salesmen/:id` | `supervisor.salesmen.$id.tsx` | `team.read` (team) | customer list; 403 unless in subtree |
| `/supervisor/customers/:id/reactivate` | `…reactivate.tsx` | `customer.reactivate` (team) | POST → `reactivateCustomer`; subtree-scoped |
| `/management` | `management._index.tsx` | `management.read` | `supervisorsWithStats` + reason counts |
| `/admin/dashboard` | `admin.dashboard.tsx` | admin | preview + history of runs, 5 per page (`?page=`, `TablePagination` below the cards); intents `trigger`(default) / `retry` / `void` (`batch_id`, optional `reason`). `retry`/`void` post back to `?page=N` and redirect there; `trigger` lands on page 1. Runs show trigger, an Indonesian label per delivery status (`DELIVERY_STATUS`), attempt, voided state. "Kirim ulang yang gagal" shows for a live run with a failed latest attempt; "Batalkan pengiriman" only for a live run with no `sent` delivery |
| `/admin/reminders` | `admin.reminders.redirect.tsx` | – | redirect → `/admin/dashboard` |
| `/admin/transaksi` | `admin.transaksi.tsx` | admin | Transaksi table + drawer; intents `create` / `update` / `delete_many`; the Excel import (icon left of "+ Tambah transaksi" → `UploadButton`) posts `preview` (multipart `.xlsx` ≤ 10 MB) / `confirm` (`preview_token`, `treat_unknown`) / `discard`, all routed through `handleUpload`. The route holds only the record-specific bits: `describeImportPreview`, `describeImportResult`, and the `parse`/`confirm` callbacks |
| `/admin/transaksi/template.xlsx` | `admin.transaksi.template.tsx` | admin | import template download |
| `/admin/imports` | `admin.imports.redirect.tsx` | – | redirect → `/admin/transaksi` |
| `/admin/masterdata?tab=` | `admin.masterdata.tsx` | admin | 3 tabs × drawer; intents `create_/update_/delete_many_` + `customer`/`salesman`/`user`; errors caught → flash. Customer rows carry `daysSinceOrder` + `overdue` (loader, `orderStanding`): columns *Transaksi terakhir* and *Status order* (Overdue / On track); the drawer shows both read-only (`ReadonlyField`, not submitted) under a `ToggleField` for Aktif/Inactive at the top Customer panel ⋮ → "Kirim pengingat kembali" (intent `resend_reminder`); salesman panel ⋮ → "Kirim pesan tes" (`RecordDrawer` `actions`, intent `send_test_message`); both need `notification.manage` (else 403) and redirect back to the panel with the outcome as `flash` |
| `/admin/audit` | `admin.audit.tsx` | admin | four lists, each paged in SQL with its own page param: activity (`page`; filter `entity`, `q`), salesman moves (`movePage`), status changes (`statusPage`), WhatsApp replies received (`replyPage`, `listInboundPage`); `pageSize` shared |
| `/admin/settings?tab=waha\|cron\|templates` | `admin.settings.tsx` | admin | sidebar submenu "Koneksi WAHA" (default) / "Jadwal Cron", no in-page tab bar; intents `save_waha` / `test_waha` / `save_cron` / `save_template` (whatsapp only, also enforced server-side; rejected text comes back as `draft`); the WAHA tab also mounts `<WahaSessionCard />` |
| `/admin/settings/waha-session` | `admin.settings.waha-session.tsx` | admin | resource route (no page): GET → `{view, error:null}` (status + QR), POST intent `login` / `logout` → `{view, error}`; unknown intent → 400. `Cache-Control: no-store` via **both** `data()` and the `headers` export (the QR is sensitive) |
| `/reports/salesman/:id` | `reports.salesman.$id.tsx` | salesman, admin | `.xlsx`; `me` = own salesman |
| `/reports/supervisor/:id` | `reports.supervisor.$id.tsx` | supervisor, admin | `.xlsx` (id = leading salesman id) |
| `/reports/management` | `reports.management.tsx` | management, admin | `.xlsx` |

**Terhapus view** (soft delete, ADR-0005): `/admin/transaksi` and each `/admin/masterdata` tab take
`?trash=1`, chosen from the status filter inside the search bar (`TableToolbar`; suggestions show the Aktif / Terhapus counts, the active choice is a removable chip; Backspace in the empty input removes it). It lists soft-deleted rows read-only with **Pulihkan** (row + bulk,
intents `restore_many` on Transaksi, `restore_many_customer|salesman|user` on Data Master); a failed restore
flashes the reason and stays in the trash view. "Hapus" now soft-deletes (flash says it can be restored).

The **Who** column above shows the permission a route requires (the admin routes need `admin.dashboard`,
`transaksi.manage`, `masterdata.manage`, `audit.read`, `settings.manage`; batch trigger/retry/void need
`notification.manage`; exports need `report.salesman` / `report.team` / `report.management`). The built-in roles map
to them exactly as the old `profiles.role` did — e.g. admin has no `customer.follow_up`, so `/salesman` is 403 for
admin. Sidebar entries are the `NAV` list in `AppShell.tsx`, each tied to a permission; a user with several
sections sees a small heading per section. Add a nav item there when adding a page. A `NAV` entry with `children` (`{tab,label}[]`) renders a
submenu, shown only while on that route and keyed by `?tab=`; **the first child is the
default** when `?tab` is absent. Data Master and Pengaturan use it.

The upload preview keeps the uploaded bytes in a module-level `Map` in
`upload.server.ts` (30 min TTL, lost on restart — DEBT-006).

## 8. Domain rules you will trip over

- **Overdue / eligible**: see `dates.ts` / `orders.server.ts` above. **Pending** (was `notified`) = "reminder
  sent, waiting for the salesman", derived by `pending.server.ts`; it ends with a follow-up, a newer order, deleting
  the customer, or voiding the run. Nothing stores or clears a flag.
- **Reason codes** are rows of `follow_up_reasons` (seeded "1"/"2"/"3"); adding one is an INSERT, no code change
  (UI, management page and exports read the table). `deactivates_customer` replaces the hard-coded "code 3 ⇒ inactive".
- **Hierarchy (ADR-0004)**: a supervisor *is* a salesman with subordinates
  (`salesmen.supervisor_id`, any depth, no cycles). "Team" = the whole subtree
  for the supervisor dashboard/export/authorisation; **direct reports only**
  for WhatsApp summaries and management's per-supervisor table (so nothing is
  double counted). A user links to their salesman row via `users.salesman_id`. The `supervisor` **role** is a
  permission bundle (scope `team`), *not* derived from the hierarchy — the two can disagree by design (ADR-0007).
- **Notifications**: each eligible salesman gets a list message; each *direct*
  supervisor of an eligible salesman gets a count-only summary as a **separate
  delivery** (`recipient_kind='supervisor'`). A supervisor's own overdue
  customers arrive as a normal salesman message. No WhatsApp contact ⇒ `skipped_no_contact`, no items, nobody becomes pending (FR-17). A failed send is recorded, never thrown, and makes nobody pending (FR-29). The text comes from the active template; the delivery keeps a snapshot.
- **Delete semantics (ADR-0005)**: soft delete everywhere for users/salesmen/customers/transaksi
  (`deleted_at`); nothing is hard-deleted (notification runs are voided, not deleted). Customer delete
  cascades its live transaksi (marked). Salesman delete is still refused while they own *live*
  customers/transaksi/direct reports. A user whose linked salesman is deleted cannot sign in. Usernames and
  customer names are unique among live rows only. Bulk deletes loop item by item (`deleteSalesmenMany`
  pre-validates the batch); bulk restores are all-or-nothing.

## 9. Tests (`npm test` — 262 passing in 20 files on `feat/erd-v2-foundation`, run 2026-09-26)

`vitest.config.ts`: `tests/**/*.test.ts`, `setupFiles: tests/setup.ts`, forks,
`maxWorkers: 1`, `~` alias. `setup.ts` points `DATABASE_PATH` at a temp file
**before** any app module opens SQLite — never import `db` in a way that
precedes it.

Pattern: `beforeEach(() => resetDb())`, then `await seedOrg()` (returns
`supervisor` "Budi Supervisor" as the top node, `salesman` "Andi Sales" and
`salesmanB` "Citra Sales" both reporting to that supervisor, `admin`, `salesmanUser`), `addCustomer({...})`
(option `pending: true` makes the customer pending; fixtures also export `isPending`, `assignmentHistory`,
`createUser`), and `TODAY = "2026-09-12"` passed as `today`. WAHA is faked with a local
`fakeClient()` (`calls[]`, `failFor`, `alwaysFail`) — see `tests/reminders.test.ts`.
**`resetDb()` deletes from the explicit `TABLES` list in `fixtures.ts` — add any
new table there.**

| Area | File |
|---|---|
| BR-1 dates | `dates.test.ts` |
| eligibility, `recordOrder`, `deleteTransaksiMany` | `orders.test.ts` |
| trigger/preview/retry/void (incl. refusing a delivered run), `runsPage`, pending derivation, follow-ups (`submitReason`) | `reminders.test.ts` |
| message templates (render, versioning, validation, audit) | `templates.test.ts` |
| "Kirim pengingat kembali": `resendReminder` (what it sends and records, refusals, cooldown, failure), the newest-reminder pending rule, the Data Master action (redirect + flash, 403 without `notification.manage`) | `resend.test.ts` |
| WhatsApp's verdict on a sent message (`ack` -1 / pending / accepted / unknown, the reachout-timelock text, the chat taken from the message id) and the session view's `restriction` | `waha-ack.test.ts` |
| "Kirim pesan tes": `sendTestMessage` (what it sends and records, refusals, cooldown), a message WhatsApp refuses after WAHA accepted it (resend voids the run, no false pending), the Data Master action (redirect + flash, 403 without `notification.manage`) | `test-message.test.ts` |
| WhatsApp replies: signature, who/what counts, numbers and "everyone", reminder choice, exactly once, confirmations and their limit | `inbound.test.ts` |
| reply text parsing (numbers, ranges, labels, notes, free text after a number or in a quoted reply, what it refuses to guess) | `reply-parser.test.ts` |
| first boot: demo seed outside production, none in production (first admin from `ADMIN_PASSWORD`) | `seed.test.ts` |
| `/logout`: GET redirects only, POST clears the cookie | `logout.test.ts` |
| the webhook route: unsigned accepted with no secret, 401 with a secret, 400, 200 | `webhook-route.test.ts` |
| salesman contacts / WhatsApp number | `contacts.test.ts` |
| schema is migrated on open (a DB left at an older schema, a fresh file, a failing migration) | `boot-migration.test.ts` |
| RBAC: catalogue = seeded table, role matrix, merged scopes, sessions, scope helpers, user form rules, password policy (≥ 8, not the demo one), last-admin guard | `rbac.test.ts` |
| reassign, reactivate, stats, bulk deletes | `masterdata.test.ts` |
| hierarchy rules + supervisor notifications | `hierarchy.test.ts` |
| legacy supervisors → salesmen migration | `migrate-supervisors.test.ts` (own in-memory DB) |
| activity log | `activity.test.ts` |
| comments, a record's paged feed, `postNote` rules (who may comment / give a reason, nothing written on refusal) | `comments.test.ts` |
| Log Audit: SQL search and paging, salesman moves, status changes | `audit-pages.test.ts` |
| `pageWindow`, `parsePage` | `pagination.test.ts` |
| Excel import | `imports.test.ts` |
| upload flow (token single-use, TTL, discard, size, unreadable) | `upload.test.ts` |
| migrations: schema drift vs `schema.ts`, legacy upgrade with data, rollback, preflight | `migrations.test.ts` |
| soft delete + restore invariants, name/username uniqueness | `trash.test.ts` |
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
| Add a field to Customer / Salesman / User | `schema.ts` → `npm run db:generate` (edit the SQL by hand if existing rows need a backfill) → the entity's create/update in `masterdata.server.ts` incl. its `*Fields()` helper (feeds the activity log) → `FIELD_LABELS` in `activity-format.ts` → `admin.masterdata.tsx` (search filter, table column, drawer input, action parsing) → tests |
| Add a field to Transaksi | same, but `orders.server.ts` (`transaksiFields`, create/update) and `admin.transaksi.tsx` |
| Add a new admin CRUD table | copy the Transaksi/Data Master pattern: loader (`q`/`paginate`/`parseDrawer`), `useRowSelection` + `BulkActionBar`, `TableToolbar` (from `TableSearch.tsx`), `TablePagination`, `<RecordDrawer>` with `remove`; add the value to `ACTIVITY_ENTITIES` (`activity-entities.ts`; `entity_type` has no DB CHECK); add `OPEN_HREF` entry in `admin.audit.tsx`; add to `TABLES` in `fixtures.ts` |
| Add a page / route | file in `app/routes/`, register in `app/routes.ts`, `requirePermission`, nav item in `AppShell.tsx` `NAV`, `homeFor` in `permissions.ts` if it is a landing page |
| Add an Excel export | builder in `reports.server.ts`, thin loader route like `reports.management.tsx`, register in `routes.ts` |
| Change the overdue rule | only `isOverdue` in `dates.ts` (dashboards, stats, reports all call it) + `dates.test.ts` |
| Change the WhatsApp text | Pengaturan → Template Pesan (a new template version), or `saveTemplateVersion`; default texts are seeded in migration 0003 |
| Add upload/import to another record | write its `parse` (→ preview, no writes) and `confirm`; in the route's action call `handleUpload(form, { parse, confirm })` and `if (upload) return upload;`; render `<UploadButton>` with `describePreview` / `describeResult` (module-level functions — keep them referentially stable) and a `template` link if there is one. Nothing in `UploadDialog`/`upload.server` needs editing. Only Transaksi uses it today |
| Change import columns/format | `HEADER_*` constants and `sheetRows`/`excelDateToIso` in `imports.server.ts`; `buildImportTemplate` must match |
| Change who sees what | the permission a route requires + the row-level check (`access.server.ts`). A **new permission** = add to `PERM`, a migration that inserts it into `permissions` and grants it to roles (the catalogue test fails until both agree). **Role changes** are data (`roles`/`role_permissions`), not code |
| Change WAHA transport | `waha.server.ts` only (keep the `WahaClient` interface so tests can fake it). Session panel: `waha.server.ts` session functions + `waha-session.ts` (states/labels) + `WahaSessionCard.tsx`; tests stub global `fetch` (see `waha-session.test.ts`) |
| Change scheduling | `cron.server.ts` / `settings.server.ts` / `admin.settings.tsx` (DEBT-010, contradicts ADR-0002) |
| Tweak look & feel | `app.css` (classes above) and the shared bits in `components/` |

## 12. Quirks worth knowing before you edit

- `SESSION_SECRET` guard runs at **module import** in production — a missing
  secret crashes the build/boot (the Dockerfile sets a placeholder for build).
- Drizzle+SQLite mishandles ``sql`(datetime('now'))` `` column defaults on some
  INSERTs (seen on the old `notification_batches`); all timestamps are therefore filled by the app
  (`nowIso()`, `$defaultFn`/`$onUpdate`). Do the same for new timestamp columns. `upsert` (`onConflictDoUpdate`)
  does not run `$onUpdate` — `writeSetting` sets `updatedAt` itself.
- `deleteSalesman` is a soft delete and keeps the users linked to it; `getAuthUser`/`verifyLogin` treat a user
  whose salesman is deleted, or who is inactive/deleted, as not signed-in (`canSignIn`). Restoring restores access.
  A session of a user who is deactivated mid-session is refused on its next request (permissions are read per request).
- **Client bundle**: anything a component uses at *runtime* (not just a type) must come from a module with no
  database imports, or the whole Drizzle schema ships to the browser (found on the audit page). That is why
  `permissions.ts`, `template-vars.ts`, `activity-entities.ts`, `activity-format.ts` and `dates.ts` are plain modules and
  `schema.ts` re-exports from them. After adding such an import, `grep -l "sqliteTable" build/client -r` should print nothing.
  In dev, the first page load after a fresh `react-router dev` re-optimises dependencies and reloads once (can freeze a
  browser tab briefly) — harmless.
- **Migrations**: `foreign_keys` must be OFF *outside* the transaction (the pragma is a no-op inside one),
  which is why drizzle's own SQLite migrator is not used. **A running `npm run dev` on the shared tree
  migrates `data/sigula.db` on the first request** — that DB is at R1/0002 now; going back to `master`
  needs a pre-R1 backup. drizzle-kit renders an expression index as a quoted column name (bad SQL) and
  `ADD COLUMN … NOT NULL` without default is invalid in SQLite — both are why 0001 is hand-written.
- Loaders load whole tables and filter in JS (`listTransaksi(2000)`,
  all customers/salesmen; Log Audit and the record feeds are paged in SQL) — fine at pilot scale, not
  beyond it. SQLite write contention is a known pilot limit.
- Login throttle and the upload-preview store are per-process memory.
- A native `<dialog>` is centred by the UA's `margin: auto`, which Tailwind's
  preflight zeroes — `.upload-dialog` sets `margin: auto` itself. Copy that for
  any new `<dialog>`.
- `admin.dashboard.tsx` confirms cancelling a run with `window.confirm`; the
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
