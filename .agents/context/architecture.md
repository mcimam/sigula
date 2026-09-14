# Architecture

> Filled during Design. Keep it current — a stale architecture doc is worse
> than none, because it is trusted.

## Shape

A React Router 7 (framework-mode) JS monolith organised by ownership modules
under `app/lib/*` and role screens under `app/routes/*`. Same business
boundaries as the former Django apps (master data, orders, reminders/WAHA,
Excel import/export, audit). Full detail in `docs/tdd/sigula-pilot.md` and
stack change in `docs/adr/0003-react-router-vs-django.md`.

## Components

| Component | Responsibility | Owns | Depends on |
|---|---|---|---|
| `lib/auth.server` | Authenticate and resolve role | `users`/`profiles` session | — |
| `lib/masterdata.server` | Canonical Salesman/Supervisor/Customer ops | `salesmen`, `supervisors`, `customers` | auth |
| `lib/orders.server` | Record orders; overdue/eligibility at read time | `order_history` | masterdata |
| `lib/reminders.server` | Admin-triggered WAHA batches; reason capture | `notification_*`, `reason_logs` | orders, WAHA |
| `lib/imports.server` | Excel preview → confirm | transient preview store | masterdata, orders |
| `lib/reports.server` | Excel export (3 shapes) | nothing persistent | masterdata, orders, reminders |
| audit tables | Append-only mutation/status trail | `mutation_logs`, `status_logs` | — |

## Boundaries

| From → To | Carries | Via | Sync/async |
|---|---|---|---|
| Admin UI → reminders | trigger/retry | RR action (HTTP POST) | Sync |
| reminders → WAHA | `{chatId, text}` | HTTP REST | Sync, per-recipient |
| imports → masterdata/orders | parsed rows | in-process, one transaction | Sync |

## Frozen decisions

- WAHA (not Meta Cloud API) — ADR-0001
- Admin-triggered batches only — ADR-0002
- React Router 7 JS monolith (not Django, not Next.js, not Express+SPA) — ADR-0003
- `notified` flips only on confirmed WAHA send success
- Overdue computed at read time, never stored

## Known weaknesses

- Sync per-recipient WAHA loop — revisit above ~20 recipients / multi-team.
- SQLite write contention — migrate to Postgres before full rollout.
- Import preview bytes held in process memory (pilot).
