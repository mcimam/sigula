# Stack

> Filled per clone. The runnable commands live in `.agents/config.yml` —
> this file explains the *choices*, that file holds the *invocations*.

## Runtime

| | |
|---|---|
| Language | TypeScript (ES2022) |
| Runtime | Node.js 22+ |
| Package manager | npm |
| Lockfile committed | yes (`package-lock.json`) |

## Frameworks and major libraries

| Library | Version | Used for | Why this one |
|---|---|---|---|
| React Router 7 (framework mode) | 8.x package line | Full-stack JS monolith: loaders, actions, React UI | Matches the original React prototype and form-centric screens (ADR-0003); closest JS equivalent to Django views+templates |
| React | 19.x | UI | Same language as `docs/user-input/sigula-deskripsi.txt` |
| Tailwind CSS | 4.x | Styling, phone-first layout | Ships with the RR template; tokens follow the teal/slate palette from the prototype |
| Drizzle ORM + better-sqlite3 | current | Schema + SQLite access | Typed SQL without a heavy ORM; SQLite stays the pilot store |
| exceljs | 4.x | Excel import/export | `.xlsx` read/write matching `Order_Tracker_2026.xlsx` |
| bcrypt | 6.x | Password hashing | Session login for the four roles |
| WAHA (external) | — | WhatsApp send to salesmen | Unchanged — ADR-0001 |

## Data

| | |
|---|---|
| Primary store | SQLite for the pilot (`data/sigula.db`); Postgres still planned before multi-team rollout |
| Migrations | Idempotent SQL bootstrap in `app/db/migrate.server.ts` (+ Drizzle schema as source of truth) |
| Cache / queue | None — same as before; WAHA sends stay sync in-request at pilot scale |

## Tooling

| | |
|---|---|
| Test framework | vitest |
| Linter / formatter | (none locked yet — use `npm run typecheck`) |
| Type checker | `tsc` via `npm run typecheck` |
| CI | none configured yet — Deployment phase |

## Environments

| Env | Where it runs | Who can deploy | Notes |
|---|---|---|---|
| local | `npm run dev` | developer | seeds demo users on first boot |
| staging | TBD | TBD | |
| production | self-hosted VPS via Docker (app + WAHA + SQLite volume) | ask-first | |

## Setting up from zero

```bash
npm install
npm run dev
# open http://localhost:5173 — demo password for all roles: sigula123
```

## Known gotchas

- WAHA still needs a real WhatsApp number + QR login; the app must keep
  tracking usable when WAHA is down (FR-29).
- SQLite concurrent writes remain a pilot-only limit.
- Import preview tokens live in process memory — lost on server restart
  (acceptable for pilot; same class of trade-off as the old Django session
  byte store).
