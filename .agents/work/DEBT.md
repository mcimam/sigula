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
| DEBT-006 | 2026-09-12 | development | minor | Import preview bytes live in an in-process `Map`, lost on restart | Pilot rewrite — same class of trade-off as the old Django session store; avoids a new table | 2h — persist preview blob to SQLite with TTL | `app/routes/admin.transaksi.tsx` |
| DEBT-008 | 2026-09-12 | development | minor | No ESLint/Prettier locked; `config.yml → lint/format` empty | RR scaffold shipped without them; typecheck covers the worst | 1h — add eslint + prettier scripts | `package.json` |
| DEBT-009 | 2026-09-13 | development | major | Order history no longer append-only — `transaksi` supports edit/delete; master customer/salesman/user can be hard-deleted | Explicit product change by user (2026-09-13); contradicts FRD BR-10 / TDD “never deleted / append-only” | half-day — ADR + FRD amendment, or restore append-only + soft-delete | `app/db/schema.ts` (`transaksi`), `app/lib/orders.server.ts`, `app/lib/masterdata.server.ts` |
| DEBT-010 | 2026-09-13 | development | major | Opt-in scheduled cron batch (`/admin/settings`) contradicts ADR-0002 manual-only default; in-process scheduler (no separate worker) | User-requested settings page for WAHA + cron; pilot still defaults to manual trigger | half-day — ADR amendment + ops runbook (restart behaviour, TZ, ban-risk comms) | `app/lib/cron.server.ts`, `app/routes/admin.settings.tsx` |

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

---

## Implicit debt — regenerated, do not hand-edit

_Run `/debt` to populate. Empty on the `production` track by definition._

| Gate | Active track | production | Means |
|---|---|---|---|
| | | | |
