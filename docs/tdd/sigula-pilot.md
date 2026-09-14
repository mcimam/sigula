# Technical Design — SiGula Pilot

| | |
|---|---|
| Status | draft |
| FRD | `docs/frd/sigula-pilot.md` |
| Date | 2026-08-31 |

## Summary

A React Router 7 (framework-mode) JS monolith (React + Tailwind + SQLite)
organised by ownership modules under `app/lib/*` and role screens under
`app/routes/*`. The one decision that most shapes it: a customer's
`notified` state flips to `true` **per recipient, only on confirmed WhatsApp
send success** — never on the trigger action alone — so a WAHA outage can
never make a customer look "handled" when nobody actually got told.

> Stack supersession: Django was replaced by React Router 7 on 2026-09-12
> per user direction — see `docs/adr/0003-react-router-vs-django.md`. FRD
> behaviours and Interfaces paths are unchanged.

## Context

Greenfield build; nothing pre-exists. It fits into the constraints already
recorded in `context/stack.md` and `context/project.md`: Django 5.x, SQLite
now → Postgres before full-scale rollout, no task queue/scheduler chosen yet,
WAHA as the sole messaging channel (ADR-0001), and notification sends must be
admin-triggered rather than scheduled (ADR-0002).

## Components

| Component | Responsibility (one sentence, no "and") | Owns | New/changed |
|---|---|---|---|
| `accounts` | Authenticates users and resolves which of the 4 roles (Admin/Supervisor/Salesman/Management) an authenticated user acts as | `User`/`Profile` (role, linked Salesman or Supervisor) | new |
| `masterdata` | Holds the canonical Salesman/Supervisor/Customer records and their editable attributes | `Salesman`, `Supervisor`, `Customer` | new |
| `orders` | Records that a customer ordered, and derives overdue/eligibility from that history at read time | `OrderHistory`; the overdue/eligibility computation | new |
| `reminders` | Runs an admin-triggered notification batch: picks eligible customers, sends via WAHA, records per-recipient delivery outcome | `NotificationBatch`, `NotificationDelivery`, `ReasonLog`; the WAHA client boundary | new |
| `imports` | Parses an Excel file into a preview, then commits it as customer/order changes once confirmed | Transient `ImportPreview`; writes through to `masterdata`/`orders` | new |
| `reports` | Renders the three Excel export shapes (salesman reminder list, supervisor team report, management summary) | Nothing persistent — read-only over the other apps | new |
| `audit` | Records mutation and status-change events as an immutable trail | `MutationLog`, `StatusLog` | new |

## Boundaries

| From → To | Carries | Via | Sync/async | Failure behaviour |
|---|---|---|---|---|
| Admin UI → `reminders` | "trigger batch" command | Django view (HTTP POST, same request) | Sync | Whole request completes with a per-recipient result summary; a slow/hanging WAHA call is bounded by a short per-message timeout so one bad recipient can't hang the batch |
| `reminders` → WAHA | `{chatId, text}` per recipient | HTTP (WAHA's REST API) | Sync, one call per recipient, within the trigger request | Timeout/4xx/5xx → that delivery recorded `failed`; batch continues to the next recipient (FRD FR-29) |
| `imports` → `masterdata`/`orders` | Parsed customer/order rows | In-process function call, after explicit confirm | Sync | Partial failure mid-commit is avoided by wrapping the commit in one DB transaction — either the whole confirmed batch applies, or none of it does |
| `masterdata`/`reminders`/`imports` → `audit` | Mutation/status-change events | In-process function call at the point of change | Sync | If the log write fails, the triggering transaction fails too (same DB transaction) — the system never silently loses an audit entry for a change that did apply |

## Data model

| Entity | Fields | Keys | Relationships | Lifecycle |
|---|---|---|---|---|
| `Supervisor` | `nama`, `nomor_wa` | PK `id` | 1—N `Salesman` | Created by Admin; never deleted in the pilot (deactivate a salesman instead of removing a supervisor) |
| `Salesman` | `nama`, `nomor_wa`, `status` (Aktif/Inactive) | PK `id`, FK `supervisor_id` (nullable) | N—1 `Supervisor`; 1—N `Customer` | Created by Admin or by import (unrecognized sheet, confirmed as new); status toggled, never deleted |
| `Customer` | `nama`, `tipe_customer` (Lama/Baru), `order_cycle_days` (≥1), `status_customer` (Aktif/Inactive), `last_order_date` (nullable), `notified` (bool), `handled_on` (nullable) | PK `id`, FK `salesman_id` | N—1 `Salesman`; 1—N `OrderHistory`, `ReasonLog` | Created by Admin or import; reassigned via mutation; status transitions per FRD BR-4/BR-5; never deleted |
| `OrderHistory` | `tanggal_order`, `sumber` (enum: seed/import/manual), `tanggal_input` | PK `id`, FK `customer_id` | N—1 `Customer` | Append-only — insert only, never updated or deleted |
| `ReasonLog` | `tanggal`, `kode_alasan` (1/2/3) | PK `id`, FK `customer_id`, FK `salesman_id` | N—1 `Customer`, N—1 `Salesman` | Append-only |
| `NotificationBatch` | `tanggal`, `triggered_by` (FK User) | PK `id` | 1—N `NotificationDelivery` | Created once per trigger action; never edited |
| `NotificationDelivery` | `customer_count`, `status` (sent/failed/skipped_no_phone), `error_message` (nullable) — exactly one of `salesman_id`/`supervisor_id` is set per row | PK `id`, FK `batch_id`, FK `salesman_id` (nullable), FK `supervisor_id` (nullable) | N—1 `NotificationBatch`; N—1 `Salesman` or N—1 `Supervisor` (exactly one) | Created per recipient per batch; `status` may be updated by a later retry action on the same row |
| `MutationLog` | `dari_salesman_id`, `ke_salesman_id`, `tanggal`, `oleh` (FK User) | PK `id`, FK `customer_id` | N—1 `Customer` | Append-only |
| `StatusLog` | `tipe` (enum: manual_inactive / manual_reactivation / auto_reactivation), `tanggal`, `oleh` | PK `id`, FK `customer_id` | N—1 `Customer` | Append-only |
| `Profile` | `role` (admin/supervisor/salesman/management) | PK `id`, FK `user_id`, FK `salesman_id` (nullable), FK `supervisor_id` (nullable) | 1—1 `User`; optional link to `Salesman`/`Supervisor` | Created at account provisioning |

**Migration:** greenfield — the first migration creates every table above.
Excel import (FRD FR-18) is the ongoing "migration" path for customer/order
data from the existing `Order_Tracker_2026.xlsx` process; no schema migration
is implied by it.

**Must never be lost:** `OrderHistory`, `MutationLog`, `StatusLog` (all
append-only by design, FRD BR-10) — these are the pilot's only record of what
actually happened, independent of the current computed state.

## Interfaces

```
POST /admin/reminders/trigger
  in:     (no body — acts on current eligible-customer state)
  out:    { batch_id, deliveries: [{recipient, type, status, customer_count}] }
  errors: 403 if not Admin; 200 with all deliveries "failed" if WAHA entirely unreachable

POST /admin/reminders/{batch_id}/retry
  in:     (no body — retries only deliveries in this batch still `failed`)
  out:    same shape as trigger
  errors: 403 if not Admin; 404 if batch doesn't exist

POST /salesman/customers/{id}/reason
  in:     { kode_alasan: 1|2|3 }
  out:    { customer: {...updated fields} }
  errors: 403 if acting salesman doesn't own this customer; 400 if kode_alasan not in {1,2,3}

POST /salesman/customers/{id}/record-order
  in:     (no body — order date is always "today")
  out:    { customer: {...updated fields} }
  errors: 403 if acting salesman doesn't own this customer

POST /admin/imports/preview
  in:     multipart file (.xlsx)
  out:    { new_customers: [...], updated_customers: [...], unchanged: N, unknown_sheets: [...] }
  errors: 400 if file unreadable or missing expected header row

POST /admin/imports/confirm
  in:     { preview_token, treat_unknown_sheets_as_new_salesman: bool }
  out:    { new_count, updated_count, unchanged_count, new_salesmen: [...] }
  errors: 409 if unknown sheets exist and the override flag is false (FRD FR-20)

GET  /reports/salesman/{id}/reminders.xlsx
GET  /reports/supervisor/{id}/team.xlsx
GET  /reports/management/summary.xlsx
  in:     (role-scoped, id must match the acting user's own scope unless Admin)
  out:    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  errors: 403 if the id doesn't belong to the acting user's scope
```

## Sequence — the critical path

```
Admin (UI) → reminders.trigger_batch()
  → orders.compute_eligible_customers()            # BR-1, BR-2 — pure read, no side effects
  → group eligible customers by salesman_id
  → create NotificationBatch
  → for each affected salesman:
      → if no nomor_wa: create NotificationDelivery(status=skipped_no_phone)
      → else: WAHA.send_text(salesman.nomor_wa, message)
          → on success: create NotificationDelivery(status=sent);
                          mark that salesman's eligible customers notified=true
          → on failure: create NotificationDelivery(status=failed)
  → for each affected supervisor (derived from the affected salesmen):
      → same send/record pattern, using aggregated summary text
  → return batch result to Admin UI
```

Where it can fail at each hop: `compute_eligible_customers` is a pure DB read
— failure here is a generic DB-unavailable case, same as any other page.
`WAHA.send_text` can time out, be refused (4xx — e.g. bad number format), or
5xx — all three are caught per-recipient and recorded as `failed`, and the
loop continues to the next recipient rather than aborting the batch. Because
`notified` only flips on a recorded `sent`, a failed or skipped delivery
leaves its customers exactly as eligible as before — a retry (or the next
trigger) naturally picks them up again with no separate reconciliation step
needed.

## Decisions

| Decision | Chosen | Rejected, and why | ADR |
|---|---|---|---|
| WhatsApp channel | WAHA (self-hosted) | Meta Cloud API — verification/template overhead not worth it for internal, low-volume, free-form messaging | `docs/adr/0001-waha-vs-meta-cloud-api.md` |
| Notification cadence | Admin-triggered batch | Scheduled/automatic — compounds WAHA ban risk, needs infra the stack doesn't have yet | `docs/adr/0002-manual-notification-trigger.md` |
| When `notified` flips to true | Per-recipient, on confirmed WAHA send success only | Flipping it at trigger time regardless of delivery outcome (what the mocked prototype does) — rejected because it would let a WAHA outage silently make overdue customers look "handled" when nobody was actually told, directly working against FRD FR-29's "tracking must keep working correctly even when WAHA is down" | *(recorded here, not a standalone ADR — see rationale in Summary above; it's a correctness fix to the prototype's mocked behaviour, not a strategic fork with two reasonable long-term options)* |
| Overdue computed vs. stored | Computed at read time from `last_order_date`/`order_cycle_days`/today | Storing a precomputed `is_overdue` flag — rejected because it would need a daily recompute job (infra this pilot doesn't have) and would drift stale between recomputes; computing at read time is always correct and cheap at pilot scale | *(implementation detail, not ADR-worthy)* |

## Failure modes

| What fails | Detected how | Behaviour | Recovery |
|---|---|---|---|
| WAHA entirely unreachable | Connection error/timeout on every send in a batch | All deliveries in the batch recorded `failed`; no customer's `notified` flips | Admin retries the batch once WAHA is back up (`POST .../retry`); nothing was lost since eligibility is recomputed, not stored |
| WAHA reachable but one salesman's number is wrong/deregistered | 4xx from WAHA for that recipient only | That delivery `failed`; other recipients in the same batch unaffected | Admin corrects the number (FR-16) and retries |
| WAHA session drops mid-pilot (needs QR re-auth) | All sends start failing at once | Same as "entirely unreachable" above | Operator re-authenticates WAHA (out of app scope); overdue tracking is unaffected the whole time (FR-29) |
| Excel file doesn't match the expected header/sheet shape | Header-row scan finds no "Nama Konsumen" column in any of the first 8 rows of a sheet | That sheet is skipped from the preview entirely (not treated as empty) | Admin fixes the file and re-uploads; nothing was applied (FR-19) |
| Two Admins trigger a batch at nearly the same moment | Not specially detected — relies on eligibility recomputation | Second trigger's eligible set naturally excludes anything the first trigger's successful sends already marked `notified` | No special handling needed; the design is idempotent by construction |
| SQLite write contention under concurrent multi-salesman actions | Django/SQLite raises a database-locked error under sustained concurrent writes | Acceptable at pilot's single-team scale (low concurrent-write volume) | Migrate to Postgres before full-scale, multi-team rollout — already the stated plan in `context/stack.md`; not re-litigated here |

## Security considerations

- **Trust boundary:** every mutating endpoint checks the acting user's role
  server-side (FRD FR-27) — the UI hiding a button is a convenience, not the
  enforcement point.
- **Untrusted input:** the uploaded Excel file is the main untrusted-input
  path. It is parsed with a library operating in data-only mode (no formula
  evaluation), and only two well-known columns plus the sheet name are ever
  read — arbitrary cell content elsewhere in the file is never executed or
  interpreted as anything but a string/date.
- **Authz checkpoints:** Supervisor- and Management-scoped reads/exports are
  filtered by the acting user's own `Profile.supervisor_id`/role at the query
  level (FRD FR-28), not just at the template/rendering level, so a crafted
  request for another supervisor's `id` still returns 403.
- **What's sensitive:** salesman/supervisor WhatsApp numbers are the only
  quasi-sensitive data in the system (internal contact info, not customer
  PII) — access to them is limited to Admin, per the permissions table. The
  WAHA API credential/session is a secret and is held in environment
  config, never logged, never returned in any API response.

## Self-review

The strongest cases against this design, argued deliberately before handing
it to Development:

**"You designed a WhatsApp webhook nobody asked for."** An earlier draft of
the Boundaries table had WAHA calling back into `reminders` with a parsed
inbound reply, implying salesmen reply by typing free text ("1", "kalah
harga", ...) into WhatsApp itself. Re-reading the FRD's own "Salesman replies
to a reminder" user flow shows the reply happens by *tapping a reason code
inside the SiGula app* — the WhatsApp message is a one-way nudge telling the
salesman to go do that, not a channel the system parses replies from. Adding
webhook + free-text-parsing infrastructure would have been unwarranted scope
sitting on an ambiguity the FRD had already resolved in its flow description.
**Revised:** the WAHA boundary is outbound-only; the row was removed from the
Boundaries table above.

**"The recipient reference on `NotificationDelivery` was a stringly-typed
polymorphic FK."** An earlier draft stored a bare `recipient_type` +
`recipient_id` pair pointing at either a `Salesman` or a `Supervisor` row with
no real foreign key — easy to end up with an orphaned or type-mismatched
reference, and no DB-level integrity check catches it. **Revised:** two
nullable FKs (`salesman_id`, `supervisor_id`), exactly one set per row —
costs one extra nullable column, buys real referential integrity.

**"A synchronous per-recipient WAHA loop inside one HTTP request doesn't
survive 10x load."** At pilot scale (≤9 salesmen + ≤4 supervisors ≈ 13 calls),
a short per-call timeout keeps the worst case bounded to well under a typical
request timeout. But this is a real ceiling, not a scalability illusion: a
future multi-team rollout with dozens of salesmen would risk the trigger
request itself timing out, and there's no partial-progress recovery within a
single HTTP call if the server is killed mid-loop. **Accepted, not revised,**
for this pilot: `context/stack.md` has already deferred choosing a task
queue until it's needed, and building one now would be solving a problem the
pilot's scale doesn't have. This is the design's clearest "what changes if
this succeeds" — full-scale rollout should move batch sending to a background
task (Celery/RQ or similar) before onboarding more than roughly one team's
worth of salesmen in a single trigger. Recorded here as the concrete revisit
trigger, sharper than "when it grows" — **revisit once a single team exceeds
~20 recipients per batch, or once more than one team is live at once.**

**"Dashboards could N+1 themselves into being slow well before 10x scale."**
Supervisor/Management aggregates (counts of Active/Inactive/needs-follow-up
per salesman, response rates) are the kind of view that's trivial to write as
a Python loop issuing one query per salesman — fine at 9 salesmen, poor at 90.
**Not revised in the design** (this is an implementation discipline, not an
architecture change), but made explicit as a constraint on Task 7: these
aggregates must be built as annotated/aggregated querysets, not per-row
Python loops, and that expectation is now stated here so it doesn't get
lost between design and implementation.

## Testing approach

- **Unit-tested:** overdue/eligibility computation across its edge cases
  (no `last_order_date`, exactly-at-boundary days, `order_cycle_days` of 1);
  reason-code branching (bankrupt vs. the other two); reactivation logic from
  each of its three triggers (manual order, supervisor manual reactivation,
  import); Excel-import name/sheet matching (case-insensitivity, unknown
  sheet, duplicate row); `order_cycle_days` clamping.
- **Integration-tested:** the full trigger → WAHA-call (mocked) →
  delivery-record → `notified`-flip pipeline, including the partial-failure
  case (one recipient fails, others succeed); the full import preview →
  confirm pipeline against a fixture file shaped like
  `Order_Tracker_2026.xlsx`; role-scoped access (a Supervisor request for
  another supervisor's `id` is refused).
- **Needs a manual check, and why it can't be automated:** an actual WhatsApp
  send to a real test number through a real WAHA instance, once before pilot
  go-live — WAHA's behaviour depends on a live WhatsApp session that can't be
  faithfully mocked end-to-end, and this is exactly the kind of integration
  risk (ADR-0001) worth eyes-on before real salesmen are involved.

## Task breakdown

Ordered by dependency, riskiest first.

| # | Task | Depends on | Verifiable by |
|---|---|---|---|
| 1 | Data model + migrations (`masterdata`, `orders`, `audit` apps) | — | `migrate` runs clean; Django admin CRUD smoke test on each model |
| 2 | Overdue/eligibility computation (`orders` app, pure logic) | 1 | Unit tests covering FRD's edge-case table |
| 3 | WAHA client boundary + `reminders` trigger/retry flow | 1, 2 | Unit tests with a mocked HTTP client (success/timeout/4xx/5xx); one manual real-send smoke test before go-live |
| 4 | Reason-code capture + reactivation rules (order/manual/import triggers) | 2 | Unit + integration tests for each of the 3 reactivation paths |
| 5 | Excel import (`imports` app: preview → confirm) | 1, 4 | Fixture-based round-trip test against an `Order_Tracker_2026.xlsx`-shaped file |
| 6 | Excel export (`reports` app: 3 report shapes) | 1, 2 | Generated-file assertions (sheet names, row counts, key columns present) |
| 7 | Role-based views for all four dashboards — Supervisor/Management aggregates built as annotated querysets, not per-row Python loops (see Self-review) | 1–4 | Per-role view/template tests, including a cross-scope-access-denied test (FR-28); query-count assertion on the aggregate views |
| 8 | Audit log views (Admin) | 1, 4, 5 | Integration test asserting a log entry appears after each of the logged action types |

## What this makes harder later

Computing overdue/eligibility at read time (rather than storing a
precomputed flag) means large-scale filtering/sorting has to happen in the
ORM at query time — acceptable through pilot-plus-10x scale, but would need
an indexed/materialized approach if the customer base grows an order of
magnitude beyond that. The admin-triggered batch model (ADR-0002) assumes
low message volume and a human in the loop; if a future need for guaranteed,
timely notification emerges, that's a real redesign (scheduler/worker
infrastructure this stack has deliberately deferred), not a config flip.
Per-recipient delivery tracking (rather than the prototype's simpler
"mark everyone notified on trigger") means the UI must clearly distinguish
"sent" from "still pending a real send" — copy that gets this wrong could
mislead an Admin into thinking a failed delivery went through.
