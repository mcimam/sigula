# Project context

> Filled per clone. `/kickoff` populates this by interviewing you.
> Delete every `<PLACEHOLDER>` — a leftover placeholder means the agent is
> working blind and it should say so rather than guess.

## What this is

SiGula is an internal sales-monitoring tool for a Yogyakarta-based sugar /
food-ingredient distributor. Today, customers who go quiet past their normal
reorder cycle are noticed ad hoc or not at all — there is no systematic
tracking (looser even than the existing `Order_Tracker_2026.xlsx`), so lapsed
accounts and missed follow-ups go unseen until revenue has already slipped.
SiGula tracks each customer's own reorder cycle, flags anyone overdue,
automatically nudges the responsible salesman over WhatsApp (via a
self-hosted WAHA gateway) to follow up, captures why a customer went quiet (or
logs their new order), and gives supervisors/management visibility into how
well the team follows up. It ships first as a pilot with a single sales team,
and only moves to full company-wide rollout once that team's usage is
manually confirmed to work — there is no fixed quantitative gate for that
decision.

## Who uses it

| Actor | Needs | Cares most about |
|---|---|---|
| Admin | Trigger reminders, manage salesman/supervisor/customer master data, review logs | Overdue flags are correct and nobody is missed |
| Salesman | Get nudged (on their phone) about overdue customers, log a reason or a new order | Low-friction logging while in the field |
| Supervisor | See their team's overdue accounts and follow-up performance | Visibility without manually chasing people |
| Management | Cross-team view of overdue trends and reasons | Aggregate trend, not per-customer detail |

## Success criteria

Observable. Not "it works".

- Fewer customers cross their own overdue threshold (days-since-last-order >
  their `order_cycle_days`) before a salesman follows up, compared to today's
  ad hoc process. No fixed target number has been set yet — see Open
  unknowns in `work/STATE.md`.
- The pilot team's usage is manually confirmed workable by whoever runs the
  pilot before expanding to full-scale rollout — a deliberate subjective
  gate, not a metric threshold.

## Non-goals

The fence around scope. What this explicitly does not do — and, where useful,
why not.

- Tracking what/how much was ordered (product, SKU, quantity, value) — the
  system only records that an order happened on a given date. Confirmed
  sufficient for this pilot.
- Automated messaging directly to end customers — WhatsApp automation
  targets only the internal salesman; the salesman still contacts the
  customer manually outside the system.
- An admin-configurable reason taxonomy at launch — the 3 reason codes
  (lost on price / still has stock / gone bankrupt) are fixed for the pilot.
  Extensibility is a stated future want, not built now.
- Full company-wide rollout in v1 — this explicitly starts as a single-team
  pilot.

## Constraints

- **Deadline:** none stated.
- **Budget / infra limits:** self-hosted VPS via Docker Compose. WAHA needs a
  dedicated WhatsApp number, separate from any employee's personal number —
  not yet acquired.
- **Must integrate with:** WAHA (self-hosted WhatsApp HTTP gateway,
  https://waha.devlike.pro/) for sending reminders to salesmen and receiving
  their reason-code replies; should stay compatible with the existing
  `Order_Tracker_2026.xlsx` shape for import (see the reference prototype at
  `docs/user-input/sigula-deskripsi.txt`).
- **Must not change:** n/a — greenfield build, no existing system to preserve.
- **Compliance / regulatory:** none flagged. Data in scope is internal B2B
  contact info (customer names, salesman/supervisor phone numbers), not
  consumer PII — revisit if that changes.

## Assumptions

Things believed true but not verified. Flag the load-bearing ones.

| Assumption | Confidence | Breaks what if wrong |
|---|---|---|
| Real customer/salesman/supervisor counts are close to the reference prototype's seed data (~9 salesmen, 4 supervisors, 536 customers) | high (user-confirmed) | Sizing/performance assumptions for pilot and rollout |
| `order_cycle_days` genuinely varies per customer, set by hand with a system-suggested value derived from order history | high (user-confirmed) | Overdue computation and the customer master-data screen |
| Salesman→supervisor org chart will be supplied before/at onboarding — not yet known (all null in the seed) | medium | Supervisor-role dashboards and customer-to-supervisor rollups can't be built/tested until this exists |
| A dedicated WhatsApp number for WAHA is not yet secured, and VPS hosting for WAHA + app is undecided | medium | Blocks any real WhatsApp sending until resolved; must be settled before pilot go-live |
| WAHA (unofficial, account-puppeting WhatsApp automation) carries real risk of the connected number being rate-limited or banned if used carelessly | high (known characteristic of the tool) | Reminder delivery could go down entirely mid-pilot — the app's overdue tracking must work standalone regardless |
| No fixed numeric target for "success" — pilot graduation is an intentionally manual/subjective call | high (explicitly chosen by user) | Ambiguity about exactly when to declare the pilot done; revisit before committing to full-scale rollout |

## Glossary

Domain terms, defined once. The agent uses these exact words in code and
documents — one concept, one word.

| Term | Means |
|---|---|
| Overdue | A customer whose days-since-last-order exceeds their own `order_cycle_days` |
| `order_cycle_days` | Expected reorder interval for a customer, in days; varies per customer, set by hand with a system-suggested value |
| Reminder | An automated WhatsApp message sent to a **salesman** (never the customer) nudging them to follow up with an overdue customer |
| Reason code | One of 3 fixed categories a salesman logs when a customer stays overdue: lost on price, still has stock, gone bankrupt |
| WAHA | Self-hosted, unofficial WhatsApp HTTP API (https://waha.devlike.pro/) used to send/receive WhatsApp messages programmatically |
| Pilot | The initial single-team rollout of SiGula; graduates to full-scale by manual confirmation, not a fixed metric |
