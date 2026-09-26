# SiGula

Internal sales-monitoring tool for a Yogyakarta sugar / food-ingredient
distributor. Tracks each customer's reorder cycle, flags overdue accounts, and
nudges salesmen over WhatsApp (via WAHA) to follow up.

Pilot scope: one sales team. See `docs/prd/sigula-pilot.md` for product intent
and `docs/tdd/sigula-pilot.md` for the technical design.

## Stack

- React Router (framework mode) + React 19
- Tailwind CSS 4
- SQLite via Drizzle / `better-sqlite3`
- Node.js 22+

## Quick start

```bash
cp .env.example .env   # set SESSION_SECRET for anything beyond local demo
npm install
npm run dev
```

Open http://localhost:5173

On first boot the app creates `data/sigula.db`. Outside production it seeds a demo
organisation with four users (`admin`, `salesman`, `supervisor`, `management`) sharing the
published password `sigula123` — local use only. In production (`NODE_ENV=production`) it
never creates demo accounts: an empty database gets one administrator, from `ADMIN_PASSWORD`
(and optionally `ADMIN_USERNAME`, default `admin`); without `ADMIN_PASSWORD` nothing is seeded
and the log says what to set. Passwords an admin sets must be at least 8 characters, and
`sigula123` is refused.

Optional WAHA (WhatsApp gateway): set `WAHA_BASE_URL` in `.env`, or configure
under Admin → Pengaturan.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Vitest suite |
| `npm run typecheck` | React Router typegen + `tsc` |

## Docker / production

```bash
cp .env.example .env   # set a strong SESSION_SECRET
podman-compose up -d --build
# or: docker compose up -d --build
```

Production on `ceater.cc` is documented in `docs/runbook-sigula.md`
(`https://sigula.ceater.cc`, host bind `127.0.0.1:3010`).

SQLite lives under `/app/data` — compose mounts a named volume so the DB
survives restarts.

## Repository layout

| Path | Contents |
|---|---|
| `app/` | Application source (routes, services, schema) |
| `tests/` | Vitest tests |
| `docs/` | PRD, FRD, TDD, ADRs |
| `.agents/` | Agent workflow config and project state |
| `data/` | Local SQLite (gitignored) |

## Environment

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | yes outside local demo | Cookie signing secret |
| `WAHA_BASE_URL` | no | Prefer Admin settings when available |
| `WAHA_SESSION` | no | WAHA session name |
| `WAHA_API_KEY` | no | If the WAHA instance requires it |
| `WAHA_TIMEOUT_MS` | no | Default `8000` |

Never commit `.env` or `data/*.db`.

## Docs

- Product: `docs/prd/sigula-pilot.md`
- Behaviour: `docs/frd/sigula-pilot.md`
- Design: `docs/tdd/sigula-pilot.md`
- Decisions: `docs/adr/`
