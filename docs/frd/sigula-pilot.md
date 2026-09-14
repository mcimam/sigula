# FRD — SiGula Pilot (Overdue Customer Tracking & Salesman Nudges)

| | |
|---|---|
| Status | draft |
| PRD | `docs/prd/sigula-pilot.md` |
| Date | 2026-08-31 |

## Scope

This document specifies the behaviour of the SiGula pilot: overdue
computation, admin-triggered WhatsApp reminder batches via WAHA, salesman
reason-code and new-order capture, customer/salesman/supervisor master data
management, Excel import/export compatible with `Order_Tracker_2026.xlsx`, and
the four role-scoped views (Admin, Salesman, Supervisor, Management). It does
not specify authentication mechanics, deployment, or the WAHA/Django wire
protocol — those are covered in the TDD.

## Actors and permissions

| Actor | Can | Cannot |
|---|---|---|
| Admin | Trigger notification batches; manage master data (salesman, supervisor, customer); set `order_cycle_days`; reassign (mutate) a customer to a different salesman; toggle a salesman's active/inactive status; set salesman/supervisor WhatsApp numbers; import/export Excel; view all audit logs | Submit a reason code or record a new order (those are salesman actions); see the Supervisor/Management dashboards as a distinct role view |
| Salesman | View their own customers; see the list of customers currently pending a reminder reply; submit one of the 3 reason codes for a pending customer; record a new order for any of their own customers; export their own reminder list (Excel/text) | See other salesmen's customers; edit master data; trigger notifications; reassign customers |
| Supervisor | View an aggregated dashboard for the salesmen mapped to them; drill into one salesman's full customer list, sorted by most overdue; manually reactivate an Inactive customer on their team; export a team report (Excel) | See other supervisors' teams; edit master data; trigger notifications; submit reason codes or record orders directly |
| Management | View a cross-team aggregate dashboard (per-supervisor performance, per-salesman response rate, reason-code breakdown); export a summary report (Excel) | Edit anything; trigger notifications; see per-customer detail (aggregate only) |

## Functional requirements

| # | Requirement | Acceptance |
|---|---|---|
| FR-1 | The system shall compute a customer's overdue status as: overdue if `last_order_date` is absent, or if days between `last_order_date` and today exceed the customer's `order_cycle_days` | Given a customer with `last_order_date` 31 days ago and `order_cycle_days` 30, when overdue status is computed, then it is `true` |
| FR-2 | The system shall flag a customer eligible-for-notification only when `status_customer` is Active and the customer is overdue | Given an Inactive overdue customer, when eligibility is computed, then it is not eligible |
| FR-3 | Admin shall be able to trigger a notification batch that sends a WhatsApp reminder (via WAHA) to every salesman with at least one eligible, not-yet-notified customer, and a summary to each affected salesman's supervisor | Given 3 salesmen each with eligible customers, when Admin triggers, then 3 salesman messages and up to 3 supervisor summaries are attempted |
| FR-4 | The system shall never send a reminder except as the direct result of an explicit Admin trigger action — no scheduled or automatic sending | Given no Admin action today, when the day advances, then zero reminders are sent (see `docs/adr/0002-manual-notification-trigger.md`) |
| FR-5 | A customer's `notified` flag shall be set only for salesmen whose delivery actually succeeds; customers under a failed or skipped-for-missing-phone delivery remain un-notified and eligible for the next trigger | Given a salesman with no WhatsApp number on file, when a batch is triggered, then that salesman's customers stay eligible and are retried on the next trigger |
| FR-6 | Salesman shall be able to view their list of customers currently awaiting a reply, sorted by days overdue, descending | Given 5 pending customers with different `daysSince`, when the salesman opens their view, then the most overdue customer is listed first |
| FR-7 | Salesman shall be able to submit exactly one of 3 fixed reason codes for a pending customer: lost on price, still has stock, gone bankrupt | Given a pending customer, when the salesman submits "lost on price", then it is recorded and no other code is recorded for that reply |
| FR-8 | Submitting "gone bankrupt" shall set the customer's status to Inactive and clear its notified flag; the other two codes shall clear the notified flag only, leaving the customer Active | Given "gone bankrupt" is submitted, when the customer is next evaluated, then it is Inactive and excluded from eligibility (FR-2) until manually or automatically reactivated |
| FR-9 | Salesman shall be able to record a new order for any of their own customers (found by name search), setting `last_order_date` to today | Given a customer found by search, when "record order" is submitted, then `last_order_date` becomes today and `notified` is cleared |
| FR-10 | Recording a new order for a previously Inactive customer shall automatically reactivate it (status becomes Active) and log the reactivation | Given an Inactive customer, when a new order is recorded for it, then its status becomes Active and a status-change log entry of type "automatic reactivation" is written |
| FR-11 | Supervisor shall be able to manually reactivate an Inactive customer on their team without a new order being recorded | Given an Inactive customer on the supervisor's team, when they reactivate it, then its status becomes Active and a status-change log entry of type "manual reactivation" is written |
| FR-12 | Admin shall be able to reassign (mutate) a customer to a different salesman, and the system shall log the change | Given a customer assigned to salesman A, when Admin reassigns it to salesman B, then the customer's `salesman_id` becomes B and a mutation-log entry records A → B, the date, and the actor |
| FR-13 | Admin shall be able to edit a customer's `order_cycle_days`, with a minimum of 1 | Given an attempt to set `order_cycle_days` to 0 or a non-number, then the system clamps it to 1 |
| FR-14 | Admin shall be able to assign or change which supervisor a salesman reports to | Given a salesman with no supervisor, when Admin assigns one, then supervisor-scoped dashboards include that salesman's customers |
| FR-15 | Admin shall be able to toggle a salesman's status between active and inactive | Given an active salesman, when toggled, then their status becomes inactive |
| FR-16 | Admin shall be able to set or update the WhatsApp number for any salesman or supervisor | Given a salesman with no number, when Admin sets one, then subsequent trigger previews no longer flag that salesman as missing a number |
| FR-17 | The notification-trigger preview shall warn Admin, non-blockingly, of any affected salesman or supervisor with no WhatsApp number on file | Given an affected salesman has no number, when Admin views the trigger screen, then a warning names that salesman, but the button to trigger remains enabled |
| FR-18 | The system shall support Excel import in the existing one-sheet-per-salesman format (matching `Order_Tracker_2026.xlsx`): columns "Nama Konsumen", "Status (Lama/Baru)", and "Tgl Terakhir Order" | Given a file in this shape, when imported, then each sheet is parsed by matching its name (case-insensitive) to an existing salesman |
| FR-19 | Import shall be preview-first: the system parses the file and shows a diff (new customers, updated order dates, unchanged count, unrecognized sheet names) before any data changes are applied | Given a file is selected, when parsing completes, then no customer or order data has changed yet — only a preview is shown |
| FR-20 | Import shall never silently overwrite or delete existing data; unrecognized sheet names shall block the import until the Admin either matches them to existing salesmen (by fixing the name) or explicitly confirms treating them as new salesmen | Given a sheet name doesn't match any salesman, when Admin confirms the import without resolving it, then the import is refused unless "treat unmatched sheets as new salesmen" was explicitly chosen |
| FR-21 | Import-driven order-date updates for a previously Inactive customer shall trigger the same automatic reactivation as FR-10 | Given an Inactive customer whose sheet row shows a newer order date, when the import is applied, then the customer is reactivated and logged |
| FR-22 | Salesman shall be able to export their own pending-reminder list as Excel and/or plain text | Given a non-empty pending list, when export is requested, then a file download is produced containing customer name, days overdue, and cycle length |
| FR-23 | Supervisor shall be able to export a team report as Excel containing a per-salesman summary sheet and a full customer-detail sheet | Given a supervisor's team, when export is requested, then both sheets are produced scoped to that supervisor's salesmen only |
| FR-24 | Management shall be able to export a summary report as Excel containing per-supervisor performance, per-salesman response rate, and a reason-code breakdown, each as its own sheet | Given the export is requested, then all three sheets are produced covering every supervisor/salesman |
| FR-25 | The system shall maintain an append-only order history log covering every recorded order regardless of source (initial data load, Excel import, manual salesman entry); entries are never edited or deleted | Given any action that sets `last_order_date`, then a corresponding order-history entry is written, and no existing entry is ever modified |
| FR-26 | The system shall maintain an audit log of customer-salesman mutations (FR-12) and customer status changes (FR-8, FR-10, FR-11, FR-21), each recording who/what/when | Given any of those actions occurs, then a corresponding log entry is queryable by Admin |
| FR-27 | Every screen and action shall be gated by the acting user's role per the Actors and permissions table | Given a user with the Salesman role, when they attempt an Admin-only action, then it is refused |
| FR-28 | Supervisor-scoped views and exports shall include only customers whose salesman's `supervisor_id` matches the acting supervisor | Given salesmen A (supervisor X) and B (supervisor Y), when supervisor X views their dashboard, then B's customers never appear |
| FR-29 | When WAHA is unreachable, overdue computation, reason-code capture, order recording, master-data editing, and all Excel import/export shall continue to function normally; only the WhatsApp send itself fails | Given WAHA is down, when Admin triggers a batch, then all deliveries are recorded as failed and every other feature remains usable |
| FR-30 | Admin shall be able to search/filter the master customer list by customer name or salesman name | Given a search term, when entered, then only matching rows are shown |

## User flows

### Admin triggers a notification batch

1. Admin opens the "Send Notification" screen; the system shows counts of
   customers eligible now vs. already pending a reply, and a per-salesman
   preview of who would be notified and how many customers each covers.
2. Admin reviews any missing-phone-number warnings (FR-17).
3. Admin presses "Send Notification Now".
4. The system creates a notification batch, attempts a WhatsApp send per
   affected salesman and per affected supervisor, and marks customers
   `notified` only for salesmen whose send succeeded (FR-5).
5. Admin sees a result summary: sent counts, failed/skipped counts, and can
   retry failed deliveries without re-picking which customers are eligible.

**Alternate paths:** No customers are currently eligible → the button is
disabled and the system explains why (FR-3 acceptance).
**Error paths:** WAHA unreachable for some or all recipients → those
deliveries are marked failed; customers they cover remain eligible for the
next trigger or a retry (FR-5, FR-29).

### Salesman replies to a reminder

1. Salesman opens their pending-reminders list (FR-6), sorted most-overdue
   first.
2. Salesman taps a customer to see the two available actions: log a reason,
   or (separately, from the order-recording panel) record a new order.
3. Salesman picks one of the 3 reason codes (FR-7).
4. The system records the reason and clears the pending state; if the code
   was "gone bankrupt", the customer becomes Inactive (FR-8).

**Alternate paths:** Salesman instead finds the customer via search and
records a new order directly (skips the reason step); this also clears the
pending state (FR-9).
**Error paths:** None — this is a same-page action with no external
dependency once the pending list has loaded.

### Salesman records a new order (reactivation)

1. Salesman searches for a customer by name among their own customers.
2. Salesman presses "Record Order".
3. The system sets `last_order_date` to today, clears `notified`, and — if the
   customer was Inactive — reactivates it and logs the reactivation (FR-9,
   FR-10).

**Alternate paths:** None.
**Error paths:** Customer not found in search → empty state, no action
possible.

### Admin imports an Excel update

1. Admin selects a `.xlsx` file matching the one-sheet-per-salesman shape.
2. The system parses it and shows a preview: new customers, customers with
   updated order dates, unchanged count, and any unrecognized sheet names
   (FR-19).
3. If there are unrecognized sheet names, Admin either cancels to fix master
   data/the file first, or explicitly confirms treating them as new salesmen
   (FR-20).
4. Admin confirms the import; the system applies additions/updates, logs
   reactivations triggered by the update (FR-21), and reports a final summary.

**Alternate paths:** Admin cancels at the preview step — nothing is changed
(FR-19).
**Error paths:** File unreadable/wrong shape → the system reports that the
format doesn't match the expected template and applies nothing.

### Supervisor reviews their team

1. Supervisor opens their dashboard: counts of Active/Inactive/needs-follow-up
   customers across their mapped salesmen, and recent notification batches
   that touched their team.
2. Supervisor drills into one salesman to see that salesman's full customer
   list, sorted by how far past cycle each customer is.
3. Supervisor may manually reactivate an Inactive customer from that list
   (FR-11).
4. Supervisor may export the team report (FR-23).

**Alternate paths:** No salesmen mapped to this supervisor yet → an empty
state explains that mapping happens in the Admin panel.
**Error paths:** None.

## Business rules

| # | Rule | Applies when |
|---|---|---|
| BR-1 | `overdue = last_order_date is null OR (today − last_order_date) > order_cycle_days` | Always, computed at read time, never stored |
| BR-2 | `eligible_for_notification = status_customer == Active AND overdue` | Determines what a trigger would act on |
| BR-3 | `notified` is set true only per-recipient on confirmed WhatsApp send success, never on trigger alone | Every notification batch |
| BR-4 | A reason code of "gone bankrupt" is the only one that changes `status_customer`; the other two clear `notified` but leave status Active | Reason submission |
| BR-5 | Any action that sets `last_order_date` to today (manual order or import) clears `notified` and, if the customer was Inactive, reactivates it | Order recording, Excel import |
| BR-6 | `order_cycle_days` has a floor of 1; non-numeric or ≤0 input is clamped to 1 | Editing a customer's cycle |
| BR-7 | Import matches a sheet to a salesman by case-insensitive exact name match only — no fuzzy matching, to avoid silently mapping a typo'd name to the wrong existing salesman | Excel import |
| BR-8 | Import only adds new customers or updates `last_order_date` on an exact (name + salesman) match; it never deletes or overwrites any other field | Excel import |
| BR-9 | Supervisor- and Management-scoped views/exports are always filtered through the salesman→supervisor mapping; a salesman with no supervisor appears in no supervisor's view | Every supervisor/management screen and export |
| BR-10 | Order history and audit logs (mutation, status) are append-only; nothing is ever edited or deleted from them | Always |

## Data

| Field | Type | Required | Validation | Notes |
|---|---|---|---|---|
| Customer.nama | text | yes | non-empty | |
| Customer.salesman_id | FK → Salesman | yes | must reference an existing salesman | |
| Customer.tipe_customer | enum (Lama/Baru) | yes | one of the two | set on import/creation |
| Customer.order_cycle_days | integer | yes | ≥ 1 (BR-6) | admin-editable |
| Customer.status_customer | enum (Aktif/Inactive) | yes | | derived transitions per BR-4/BR-5 |
| Customer.last_order_date | date | no | valid date, not future | null means "never ordered" (FR-1) |
| Customer.notified | boolean | yes | | per-recipient delivery success only (BR-3) |
| Customer.handled_on | date | no | | last date a reason/order cleared its pending state |
| Salesman.nama | text | yes | non-empty | |
| Salesman.nomor_wa | text | no | phone-shaped when present | blank triggers FR-17 warning |
| Salesman.supervisor_id | FK → Supervisor | no | | null until org chart supplied |
| Salesman.status | enum (Aktif/Inactive) | yes | | FR-15 |
| Supervisor.nama | text | yes | non-empty | |
| Supervisor.nomor_wa | text | no | phone-shaped when present | |
| ReasonLog entry | kode_alasan 1/2/3 | yes | one of exactly 3 | fixed taxonomy, non-goal to extend |

## Edge cases

Filled deliberately, not as an afterthought. Empty, zero, maximum, duplicate,
concurrent, out-of-order, expired, malformed, absent.

| Case | Expected behaviour |
|---|---|
| Customer has never had an order (`last_order_date` absent) | Always overdue (FR-1); appears eligible as soon as active |
| `order_cycle_days` set to 0 or negative | Clamped to 1 (BR-6) |
| Trigger pressed with zero eligible customers | Action is a no-op with an explanatory message, no batch created |
| Trigger pressed twice in a row (double-click) | Second trigger only picks up customers still eligible after the first (already-notified customers are excluded by BR-2/BR-3) — safe to repeat |
| Salesman or supervisor has no WhatsApp number | Delivery is skipped, customers stay eligible, warning shown non-blockingly (FR-5, FR-17) |
| Excel import: sheet name doesn't match any salesman (typo or genuinely new) | Blocked until explicitly resolved (FR-20); never silently guessed |
| Excel import: same customer name appears twice under the same salesman in one sheet | Treated as duplicate rows against the same existing customer; only the last date encountered is applied |
| Excel import: customer exists under a different salesman with the same name | Not matched (match requires same salesman) — imported as a new customer under the sheet's salesman |
| Customer reassigned to a new salesman (FR-12) mid-cycle | `notified`/overdue state is untouched by reassignment; only `salesman_id` changes |
| Reason code submitted for a customer no longer pending (already handled by someone else, e.g. race between two devices) | Submission still records the reason entry (audit trail), but has no further effect since the customer is already not-pending |
| Customer marked Inactive via "gone bankrupt" later reappears in a fresh Excel import with a new order date | Reactivated automatically per BR-5/FR-21, same as any other reactivation path |
| WAHA send times out mid-batch | That recipient's delivery is marked failed; other recipients in the same batch are unaffected (FR-29) |

## Error handling

| Condition | User sees | System does |
|---|---|---|
| WAHA unreachable/timeout during trigger | Per-recipient failed/skipped counts, with a retry action | Records delivery failure; does not mark those customers notified |
| Excel file unreadable or wrong shape | Message explaining the expected template shape | Parses nothing, applies nothing, no preview shown |
| Import preview has unresolved unknown sheets and Admin confirms without the override | Message asking to resolve the sheet names first, or explicitly opt into "treat as new salesmen" | Import is refused, no data changed |
| Non-Admin attempts an Admin-only action | Action is not available/visible | Server-side check refuses it regardless of UI state (FR-27) |

## Non-functional requirements

| Aspect | Requirement |
|---|---|
| Performance | Overdue/eligibility computation and dashboard queries stay responsive at 10x the pilot's reference scale (≈5,000 customers, ≈90 salesmen) without needing a redesign |
| Volume | A single notification batch at pilot scale covers ≤9 salesmen and ≤4 supervisors; WAHA send volume is kept conservative to avoid the number being flagged (see `docs/adr/0002-manual-notification-trigger.md`) |
| Availability | Overdue tracking, master data, reason/order capture, and Excel import/export must keep working with WAHA fully unreachable (FR-29) |
| Security | Role-based access enforced server-side (FR-27); phone numbers treated as internal contact data, not public; no product/price/PII beyond names and B2B phone numbers is stored |
| Accessibility | Phone-first layout (salesmen work this mostly on phones); status is never color-only — every status pill also carries a word, per the design-system reference in `docs/user-input/General Design System-handoff/` |

## Open questions

| Question | Blocks | Owner |
|---|---|---|
| Numeric target for "fewer overdue customers" success criterion | Knowing objectively when the pilot has worked | User — may deliberately stay subjective (already noted in `context/project.md`) |
| Salesman→supervisor org chart | Testing supervisor/management views against real data | User — to supply before/at onboarding |
| Dedicated WhatsApp number + VPS for WAHA | Any real WhatsApp sending; go-live | User / Deployment phase |
| Whether a later iteration should ever add scheduled/automatic sending | Would require revisiting `docs/adr/0002-manual-notification-trigger.md` | Parked — not needed for the pilot |
