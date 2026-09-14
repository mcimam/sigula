# PRD — SiGula Pilot (Overdue Customer Tracking & Salesman Nudges)

| | |
|---|---|
| Status | draft |
| Owner | Sales operations (single-team pilot) |
| Date | 2026-08-31 |
| Track | production |

## Problem

Salesmen at a Yogyakarta sugar/food-ingredient distributor lose track of customers
who go quiet past their normal reorder cycle. There is no systematic process
today — looser even than the existing `Order_Tracker_2026.xlsx` spreadsheet — so
overdue accounts get noticed late, or not at all, and follow-up is inconsistent
across the team. Supervisors and management have no visibility into how well the
team is actually following up on lapsed accounts.

## Who has it

| Actor | Situation today | Cost of that |
|---|---|---|
| Salesman | Tracks reorder timing from memory or ad hoc spreadsheet checks | Misses overdue customers; no reminder when a cycle is about to lapse |
| Admin | Manually eyeballs `Order_Tracker_2026.xlsx` to spot who's overdue | Time-consuming, error-prone, no audit trail of who was told what |
| Supervisor | No structured view of their team's follow-up performance | Can't tell who on the team is behind, or why a customer went quiet |
| Management | No cross-team visibility | Can't see aggregate overdue trends or the real reasons behind churn |

## Why now

The spreadsheet-only process has already let overdue accounts slip through
unnoticed; the team is willing to pilot a small, focused tool with one team
before deciding whether to roll it out company-wide.

## Success criteria

| # | Criterion | How it is measured |
|---|---|---|
| 1 | Fewer customers cross their own overdue threshold (days since last order > `order_cycle_days`) before a salesman follows up, vs. today's ad hoc process | Compare overdue-then-followed-up latency before/after pilot; no fixed numeric target set — a directional improvement, confirmed manually |
| 2 | Pilot team's day-to-day usage is judged workable before expanding | Manual go/no-go call by whoever runs the pilot — a deliberate subjective gate, not a metric |

## Non-goals

- Tracking what/how much was ordered (product, SKU, quantity, value) — the
  system only records that an order happened, and on what date.
- Automated messaging to end customers — WhatsApp automation targets only
  internal salesmen; the salesman still contacts the customer manually,
  outside the system.
- An admin-configurable reason taxonomy at launch — 3 fixed reason codes
  (lost on price / still has stock / gone bankrupt) for the pilot.
- Full company-wide rollout in v1 — this starts as a single-team pilot.

## Proposed solution

A Django web app (htmx + Bootstrap 5, phone-first) that holds master data for
salesmen, supervisors, and customers (including each customer's own reorder
cycle length); computes, at read time, which active customers are overdue;
lets an Admin explicitly trigger a WhatsApp reminder batch (sent via a
self-hosted WAHA gateway) to the affected salesmen, with a summary forwarded to
their supervisors; lets a salesman reply with one of the 3 fixed reason codes
or log that the customer ordered again; and gives Supervisor and Management
roles their own read-mostly dashboards plus Excel export. Master data
supports Excel import/export compatible with the existing
`Order_Tracker_2026.xlsx` shape, since that is how the team already tracks new
orders per salesman.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep improving the existing Excel workflow (better formulas, conditional formatting) | Doesn't solve the core problem — nobody is prompted to look until it's already checked manually; no reminder mechanism, no role-based visibility |
| Meta's official WhatsApp Business API instead of WAHA | Requires business verification and a paid, approved sending flow; team wants to pilot immediately without that overhead — see `docs/adr/0001-waha-vs-meta-cloud-api.md` |
| Automatic/scheduled reminder sending (e.g. a nightly job) instead of an admin-triggered batch | Riskier on an unofficial, account-puppeting WhatsApp gateway (WAHA) where sustained automated volume raises the chance of the number being rate-limited or banned; see `docs/adr/0002-manual-notification-trigger.md` |

## Assumptions

| Assumption | Confidence | What breaks if wrong |
|---|---|---|
| Real customer/salesman/supervisor counts are close to the reference prototype's seed data (~9 salesmen, 4 supervisors, ~536 customers) | High (user-confirmed) | Sizing/performance assumptions for pilot and rollout |
| `order_cycle_days` genuinely varies per customer, set by hand | High (user-confirmed) | Overdue computation and the customer master-data screen |
| Salesman→supervisor org chart will be supplied before/at onboarding | Medium | Supervisor dashboards can't be exercised with real data until this exists |
| A dedicated WhatsApp number for WAHA, and VPS hosting, will be secured before pilot go-live | Medium | Blocks any real WhatsApp sending; overdue tracking itself does not depend on it |
| WAHA (unofficial, account-puppeting) carries real risk of the connected number being rate-limited or banned if used carelessly | High (known characteristic of the tool) | Reminder delivery could go down mid-pilot — tracking must keep working standalone regardless (see FR-29 in the FRD) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WAHA-connected number gets rate-limited/banned | Medium | High — reminders stop working entirely | Admin-triggered batches only (no automatic cadence), conservative volume, degrade gracefully when WAHA is down (FRD FR-29) |
| Supervisor org chart not ready in time | Medium | Medium — supervisor dashboards can't be validated with real data | Ship the feature regardless; test with seed-like fixture data until the real chart lands |
| SQLite concurrent-write limits under multi-salesman use | Low at pilot scale | Medium if hit | Migrate to Postgres before full-scale rollout (already the stated plan in `context/stack.md`) |
| Excel import silently creates duplicate/wrong salesman mapping from a typo'd sheet name | Medium | Medium — bad data enters master data | Import is preview-first; unrecognized sheet names block the import until the Admin resolves them (FRD FR-19/FR-20) |

## Out of scope for now, likely later

- Configurable/admin-editable reason taxonomy (parked until 3 fixed codes prove
  insufficient).
- Full company-wide rollout (deliberately deferred past the pilot).
- Automatic/scheduled reminder sending, or migrating off WAHA to Meta's
  official Business API (both recorded as reversible-later calls in their
  respective ADRs).
