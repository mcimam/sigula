# ADR-0003 — React Router 7 (framework mode) replaces Django as the monolith

| | |
|---|---|
| Status | accepted |
| Date | 2026-09-12 |
| Deciders | User (explicit: option C, full rewrite, install approved) |

## Context

The pilot was designed and built as a Django monolith (htmx + Bootstrap 5)
through Testing phase. The original product shape the user wanted to match is
the React prototype in `docs/user-input/sigula-deskripsi.txt` — a single
React codebase with form-centric screens, not server-rendered Django
templates. After Testing sign-off, the user directed a full stack rewrite to
a JS monolith so the shipped app looks and feels like that original plan.

Constraints that still hold from ADR-0001/0002 and the FRD: WAHA outbound
only, admin-triggered batches only, SQLite for the pilot, same role model
and business rules. This ADR only changes *how* those are hosted.

## Options considered

### Option A — Next.js (App Router)
- **How it works:** Full-stack React with RSC, Route Handlers, and a
  Node/edge runtime; UI and API in one repo.
- **For:** Closest popular React full-stack default; large ecosystem.
- **Against:** RSC + client-boundary complexity is heavier than this
  form-POST internal tool needs; farther from the prototype's plain
  React interaction model.

### Option B — Express + React (Vite) SPA
- **How it works:** Separate JSON API and SPA; monorepo or two packages.
- **For:** Clear API/UI split; easy to swap either side later.
- **Against:** Two deployables and a CORS/session story for a single-team
  pilot; loses the "one request = one form action" simplicity the FRD
  screens already assume.

### Option C — React Router 7 (framework mode) / Remix lineage
- **How it works:** One Node process serves loaders, actions, and React
  UI; progressive enhancement via document forms; SQLite via a query
  library in the same process.
- **For:** Matches the prototype's React UI; form-centric like Django
  views; true JS monolith (one deploy); loaders/actions map cleanly onto
  the TDD's Interfaces table.
- **Against:** Team must leave Python tooling (uv/pytest/ruff); ORM
  features like Django admin must be rebuilt as ordinary routes.

## Decision

We chose **Option C — React Router 7 (framework mode)**.

**Why the others lost.** Next.js adds RSC complexity without buying
anything the FRD needs. Express+SPA splits what the pilot wants to keep
as one process. React Router 7 is the closest JS equivalent to "Django
views + templates" while keeping React as the UI language the original
plan used.

## Consequences

**Accepted costs:** Rewrite of all Django apps, tests, and ops commands;
no free Django admin — master-data and audit screens become ordinary
authenticated routes; Python debt entries that referenced Django
settings become obsolete and are closed or rewritten.

**What this makes easy:** UI that matches the React prototype and the
design-system handoff; shared TypeScript types across loaders and
components; one `npm` toolchain.

**What this makes hard:** Annotated-queryset-style SQL must be written
deliberately (Drizzle/raw SQL) rather than inherited from Django ORM
habits.

**What we now cannot do:** Keep the existing Python test suite or
`manage.py` workflows without a parallel stack (rejected — full rewrite).

## Revisit when

The pilot expands to multi-team scale and the sync-per-recipient WAHA
loop or SQLite write contention forces a background worker / Postgres
split — that may reopen "API service vs. monolith", not necessarily
leave React Router.
