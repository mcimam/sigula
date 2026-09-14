# Project state

> The agent reads this at the start of every session to find out where things
> stand. Keep it current.

| | |
|---|---|
| Project | SiGula |
| Track | production |
| Phase | development |
| Updated | 2026-09-14 |

## Now

**Repo hygiene (2026-09-14):** root `README.md`, tightened `.gitignore` /
`.dockerignore`, `data/.gitkeep`, `engines.node >=22`, `.env.example`
documented. Remote `origin` → `git@github.com:mcimam/sigula.git` added by
user; first app commit in progress. Push still needs explicit approval.

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

## Decisions log

| Date | Decision | Where recorded |
|---|---|---|
| 2026-09-12 | Replace Django monolith with React Router 7 (framework mode) JS monolith | `docs/adr/0003-react-router-vs-django.md` |
| 2026-08-31 | WAHA over Meta Cloud API | `docs/adr/0001-waha-vs-meta-cloud-api.md` |
| 2026-08-31 | Manual notification trigger only | `docs/adr/0002-manual-notification-trigger.md` |

## Parked

- Configurable reason taxonomy — revisit once the fixed 3 codes prove insufficient.
