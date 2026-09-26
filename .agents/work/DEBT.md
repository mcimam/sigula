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
| DEBT-009 | 2026-09-13 | development | major | Order history no longer append-only — `transaksi` supports edit/delete; master customer/salesman/user can be hard-deleted | Explicit product change by user (2026-09-13); contradicts FRD BR-10 / TDD “never deleted / append-only” | half-day — ADR + FRD amendment, or restore append-only + soft-delete | `app/db/schema.ts` (`transaksi`), `app/lib/orders.server.ts`, `app/lib/masterdata.server.ts` |
| DEBT-012 | 2026-09-26 | development | minor | FRD/TDD/PRD bodies still describe a separate Supervisor entity (`Supervisor.*`, `Profile.supervisor_id`, FR-14/FR-28/BR-9 wording); only amendment banners at the top point to ADR-0004 | The change was code + ADR first; rewriting three long docs line-by-line was out of proportion for the same change set | 1–2h — fold the ADR-0004 wording into the FRD/TDD/PRD tables and the Data section | `docs/frd/sigula-pilot.md`, `docs/tdd/sigula-pilot.md`, `docs/prd/sigula-pilot.md` |
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
| DEBT-011 | 2026-09-22 | paid | `<select>` fields sizing to their widest `<option>` text pushed the row wider than the viewport on mobile, at worst making the Simpan button unreachable without horizontal scroll on the Salesman/User edit rows. Fixed with a `@media (max-width: 480px)` rule scoped to a new `.edit-row-form` class (added to all 4 inline edit-row forms: Transaksi, Customer, Salesman, User) that stacks each field to `width: 100%` below that breakpoint, instead of a blanket `.form-control` change that would have also shrunk the full-width login inputs. Verified: every tab's Simpan button now sits fully inside the visible viewport at 390px (checked via `getBoundingClientRect` against `.table-wrap`'s actual visible bounds, not just its `clientWidth`), and desktop text (e.g. "Warung Sejahtera (on-cycle)") no longer truncates. |

---

## Implicit debt — regenerated, do not hand-edit

_Run `/debt` to populate. Empty on the `production` track by definition._

| Gate | Active track | production | Means |
|---|---|---|---|
| | | | |
