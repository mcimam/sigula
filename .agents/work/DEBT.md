# Debt ledger

Every shortcut this project is knowingly carrying. This is the promotion
backlog: `/track poc production` reads it to tell you what "doing it properly"
actually costs.

Maintained by `/debt`. Read `.agents/skills/debt-tracking/SKILL.md` for the rules.

---

## Open

| ID | Opened | Phase | Sev | What was skipped | Why | Fix cost | Code |
|---|---|---|---|---|---|---|---|
| DEBT-001 | 2026-09-12 | development | minor | Excel import still accepts a future `last_order_date` without rejecting it | Carried forward from the Django era into the RR7 port; same FRD gap | 1h — reject/clamp in `imports.server.ts` + test | `app/lib/imports.server.ts` |
| DEBT-006 | 2026-09-12 | development | minor | Upload preview bytes live in an in-process `Map`, lost on restart | Pilot rewrite — same class of trade-off as the old Django session store; avoids a new table | 2h — persist preview blob to SQLite with TTL | `app/lib/upload.server.ts` |
| DEBT-008 | 2026-09-12 | development | minor | No ESLint/Prettier locked; `config.yml → lint/format` empty | RR scaffold shipped without them; typecheck covers the worst | 1h — add eslint + prettier scripts | `package.json` |
| DEBT-009 | 2026-09-13 | development | major — **mitigated 2026-09-26** (ADR-0005): deletes are soft, restorable and audited; FRD BR-10 still to be amended | Order history no longer append-only — `transaksi` supports edit/delete; master customer/salesman/user can be hard-deleted | Explicit product change by user (2026-09-13); contradicts FRD BR-10 / TDD “never deleted / append-only” | half-day — ADR + FRD amendment, or restore append-only + soft-delete | `app/db/schema.ts` (`transaksi`), `app/lib/orders.server.ts`, `app/lib/masterdata.server.ts` |
| DEBT-012 | 2026-09-26 | development | minor; ADR-0005/0006 (soft delete, migrations, runs/items/templates, follow-ups) are likewise only referenced by banners | FRD/TDD/PRD bodies still describe a separate Supervisor entity (`Supervisor.*`, `Profile.supervisor_id`, FR-14/FR-28/BR-9 wording); only amendment banners at the top point to ADR-0004 | The change was code + ADR first; rewriting three long docs line-by-line was out of proportion for the same change set | 1–2h — fold the ADR-0004 wording into the FRD/TDD/PRD tables and the Data section | `docs/frd/sigula-pilot.md`, `docs/tdd/sigula-pilot.md`, `docs/prd/sigula-pilot.md` |
| DEBT-013 | 2026-09-26 | development | minor | Soft-deleted rows are never purged and there is no "hapus permanen"; the "Terhapus" views only restore | User chose soft delete + Pulihkan; purge was not asked for (ADR-0005) | 3h — admin purge for rows soft-deleted > N days with no live references, audited | `app/lib/trash.server.ts` |
| DEBT-014 | 2026-09-26 | development | minor | Only WhatsApp has a sender and a form field; email/SMS/push contacts and email templates exist in the schema but nothing sends them and the email templates are hidden/uneditable | User: templates for WhatsApp and email exist, email hidden for now (ADR-0006) | 1–2d per channel — sender + verification + template subject UI | `app/lib/reminders.server.ts` (`ACTIVE_CHANNELS`), `app/lib/templates.server.ts` (`EDITABLE_TEMPLATE_CHANNELS`) |
| DEBT-015 | 2026-09-26 | development | minor | `follow_ups.outcome` `will_order` / `unreachable` are in the schema but the salesman UI only records `not_ordering` + reason | User: follow-up UI stays as it is (ADR-0006) | 3h — two buttons + tests | `app/lib/follow-ups.server.ts` |
| DEBT-016 | 2026-09-26 | development | minor | `import_batches.file_sha256` is stored but importing the same file twice is not detected or warned about | Enforcing it needs a preview warning in the upload contract; provenance alone was the R1 goal | 2h — warn in `describePreview` + test | `app/lib/imports.server.ts` |
| DEBT-017 | 2026-09-26 | development | minor | Roles, permissions and grants are seed-only: no UI to create a role or edit its permissions; a new permission or role needs a migration | User chose "seed + pick roles in the user form" (ADR-0007) | 1–2d — Role & Izin page with safeguards (last admin, system roles) + tests | `app/lib/roles.server.ts`, `drizzle/0004_rbac_roles_permissions.sql` |
| DEBT-018 | 2026-09-26 | development | minor | The rule "a role with `own`/`team` permissions needs a linked salesman" is enforced by the application only (the old `profiles` CHECK could not survive many roles per user); `users.salesman_id` is also not unique | Multi-role made the DB CHECK inexpressible in SQLite; profiles never enforced uniqueness | 2h — trigger or a periodic consistency test/report | `app/lib/masterdata.server.ts` (`assertSalesmanLinked`), `app/lib/access.server.ts` (`requireSalesmanId`) |
| DEBT-010 | 2026-09-13 | development | major | Opt-in scheduled cron batch (`/admin/settings`) contradicts ADR-0002 manual-only default; in-process scheduler (no separate worker) | User-requested settings page for WAHA + cron; pilot still defaults to manual trigger | half-day — ADR amendment + ops runbook (restart behaviour, TZ, ban-risk comms) | `app/lib/cron.server.ts`, `app/routes/admin.settings.tsx` |
| DEBT-019 | 2026-09-26 | testing | minor | No Content-Security-Policy. The framework's inline hydration scripts need a per-request nonce, i.e. a custom `entry.server.tsx`; X-Frame-Options, nosniff, Referrer-Policy and HSTS are set instead | Security review: header set added cheaply, CSP is its own piece of work | 3h — reveal the entry, add a nonce, test hydration | `app/root.tsx` |
| DEBT-020 | 2026-09-26 | testing | **major until a secret is set in production** (deployed 2026-09-26 with no secret; WAHA does not call the endpoint yet, so nothing reaches it) | The WAHA webhook signature is optional (user's decision): with no `waha.webhook_secret` the endpoint takes any caller, so anyone who knows the URL and a salesman's number can forge a reply — record a reason for that salesman's customers (a bare "Sudah Bangkrut" deactivates them) and make us send that salesman a confirmation. Limits in place: sender must be a salesman's number, session must match, 1 MB cap, strangers' rows bounded | User asked for HMAC to be optional (WAHA sent none) | 10 min of ops: set the secret in Pengaturan and `WHATSAPP_HOOK_HMAC_KEY` in WAHA | `app/routes/webhooks.waha.tsx` |
| DEBT-021 | 2026-09-26 | testing | minor | The container runs as root (no `USER`) | Switching needs the data volume's ownership changed on the production host, which cannot be rehearsed here | 1h + a test on the host | `Dockerfile` |
| DEBT-022 | 2026-09-26 | testing | minor | `allowedActionOrigins` includes `*.ceater.cc`: a sibling subdomain (e.g. `waha.ceater.cc`) is same-site, so it could post actions carrying an admin's session cookie | Added when the HTTPS origin behind Caddy was fixed; whether `sigula.ceater.cc` alone suffices can only be seen on production | 30 min — keep only `sigula.ceater.cc`, then submit a form on production | `react-router.config.ts` |
| DEBT-023 | 2026-09-26 | testing | minor | `npm audit --omit=dev`: `uuid` < 11.1.1 (moderate, via `exceljs`). `exceljs` only calls `uuid.v4()` without a `buf`, which the advisory (v3/v5/v6 with `buf`) does not touch — not reachable | The only fix is a breaking `exceljs` downgrade | revisit when `exceljs` updates | `package.json` |
| DEBT-024 | 2026-09-26 | testing | minor | No rate limit on the webhook, comments or reasons; the login throttle is keyed by `X-Forwarded-For`, which a direct caller can spoof | One team, Caddy in front | 3h | `app/routes/login.tsx` |
| DEBT-025 | 2026-09-26 | testing | minor | WhatsApp messages from salesmen are kept 180 days (`inbound_messages`) and shown to `audit.read`; strangers' text is not kept. There is no PII inventory or named owner for the retention | The constant is deliberate but the policy is not written | 1h | `app/lib/inbound.server.ts` |
| DEBT-026 | 2026-09-26 | deployment | minor | The image compiles `better-sqlite3` from source (no prebuilt binary for this Node/Alpine) and node-gyp downloads Node headers at build time; on 2026-09-26 that download timed out twice in `podman-compose up -d --build`. Worked around with `podman build --jobs 1 --network=host` | Found during the production deploy; the earlier build (2026-09-14) had succeeded | 2h — a Debian-slim base with prebuilt binaries, or headers vendored into the build | `Dockerfile` |

## Accepted

| ID | Accepted | By | What | Why it is acceptable | Revisit when |
|---|---|---|---|---|---|
| | | | | | |

## Closed

| ID | Closed | Outcome | Note |
|---|---|---|---|
| DEBT-002 | 2026-09-12 | obsolete | Django session lifetime — replaced by 12h cookie session in RR7 auth |
| DEBT-003 | 2026-09-12 | obsolete | Encryption-at-rest note still valid as infra, but the Django settings marker is gone; reopen as Deployment item when VPS lands |
| DEBT-004 | 2026-09-12 | obsolete | `uv.lock` / pip-audit — stack is npm now; revisit as CI `npm audit` in Deployment |
| DEBT-005 | 2026-09-12 | obsolete | Django `theme.css` inline tag — static assets served by Vite |
| DEBT-007 | 2026-09-12 | paid | Vitest suite rebuilt: isolated SQLite harness + 38 tests covering BR-1/2, recordOrder/reactivation, trigger/double-trigger/preview/retry/skip/fail, reason codes, reassign/reactivate/stats, Excel import/export edges, auth throttle — `npm test` green |
| DEBT-011 | 2026-09-22 | paid | `<select>` fields sizing to their widest `<option>` text pushed the row wider than the viewport on mobile, at worst making the Simpan button unreachable without horizontal scroll on the Salesman/User edit rows. Fixed with a `@media (max-width: 480px)` rule scoped to a new `.edit-row-form` class (added to all 4 inline edit-row forms: Transaksi, Customer, Salesman, User) that stacks each field to `width: 100%` below that breakpoint, instead of a blanket `.form-control` change that would have also shrunk the full-width login inputs. Verified: every tab's Simpan button now sits fully inside the visible viewport at 390px (checked via `getBoundingClientRect` against `.table-wrap`'s actual visible bounds, not just its `clientWidth`), and desktop text (e.g. "Warung Sejahtera (on-cycle)") no longer truncates. |

---

## Implicit debt — regenerated, do not hand-edit

_Run `/debt` to populate. Empty on the `production` track by definition._

| Gate | Active track | production | Means |
|---|---|---|---|
| | | | |
