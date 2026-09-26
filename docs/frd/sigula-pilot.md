# FRD — SiGula Pilot (Overdue Customer Tracking & Salesman Nudges)

| | |
|---|---|
| Status | draft |
| PRD | `docs/prd/sigula-pilot.md` |
| Date | 2026-08-31 |

> **Amendment 2026-09-26 (ADR-0005 `docs/adr/0005-erd-v2-foundation-migrations-and-soft-delete.md` and
> ADR-0006 `docs/adr/0006-notifications-and-follow-ups-model.md`).** Read the body with these changes:
> - **BR-10 (order history is append-only)** is replaced by *soft delete*: a transaksi, customer, salesman or user
>   that is "deleted" is hidden and can be restored from the **Terhapus** view; every change is in the activity
>   log. Nothing is purged. Customer names are unique per salesman ignoring case; usernames among live accounts.
> - **`Customer.notified` / `handled_on` no longer exist.** "Notified" means *pending*: the customer has a
>   reminder on a sent salesman message (a run that has not been voided) with no follow-up and no newer order.
>   It is derived from `notification_items`; deleting a batch is replaced by **voiding** it — which, from 2026-09-26,
>   is allowed only for a run that delivered nothing (all messages failed or were skipped). A run with any sent
>   message cannot be voided; its customers stay pending until the salesman gives a reason or an order arrives.
> - **Reminder text** comes from editable, versioned templates (Pengaturan → Template Pesan); a delivery records
>   the exact text, address, template version, provider message id and attempt. A retry is a new delivery.
> - **Reason codes 1/2/3** are rows of `follow_up_reasons`; a reason can be flagged as "deactivates the customer".
>   `reason_logs` became `follow_ups`.
> - A salesman's WhatsApp number is a `salesman_contacts` row (channel `whatsapp`); a blank number means no contact.
> - `MutationLog` became `customer_assignments` (who held a customer, from/to); `StatusLog` became
>   `customer_status_history` (from/to/reason); each Excel import is recorded in `import_batches`.
> - **Roles (ADR-0007):** access is role-based with permissions and a data scope (own / team / all). A user may hold
>   several roles (merged, widest scope wins); the four built-in roles behave as the old Admin / Salesman / Supervisor /
>   Management. An account can be deactivated ("Akun aktif") without deleting it, and the last account that manages
>   master data cannot be removed, deactivated or deleted.
> - "Today" is the Asia/Jakarta calendar date; timestamps are ISO-8601 UTC.
> (DEBT-012 still lists the sections of this document that have not been rewritten line by line.)

> **Amendment 2026-09-26 (ADR-0004, `docs/adr/0004-salesman-hierarchy-replaces-supervisors.md`).**
> "Supervisor" is no longer a separate entity: it is a salesman who has
> subordinate salesmen (salesman 1—N salesman, any depth). Read every
> "Supervisor"/`supervisor_id` below accordingly: `Supervisor.nama`/`nomor_wa`
> are the leading salesman's; a supervisor-role user is linked to that salesman;
> FR-14 assigns a salesman's *supervisor (another salesman)* with cycle
> rejection; FR-28/BR-9 scope supervisor views to the **whole subtree** of the
> acting supervisor's salesman, while the WhatsApp summary (FR-3) goes to the
> **direct** supervisor only and management's per-supervisor view uses **direct
> reports**. Also see FR-31 (record activity log) added the same day.
>
> **Amendment 2026-09-26 (WhatsApp session).** FR-32 lets Admin see the status of
> the WAHA WhatsApp session and log it in/out from Pengaturan, like the WAHA
> dashboard. Previously re-authenticating WAHA was out of app scope (TDD failure
> modes).

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
| Admin | Trigger notification batches; manage master data (salesman, supervisor, customer); set `order_cycle_days`; reassign (mutate) a customer to a different salesman; toggle a salesman's active/inactive status; set salesman/supervisor WhatsApp numbers; import/export Excel; view all audit logs; see the WhatsApp session status and log the WAHA session in (QR scan) or out (FR-32) | Submit a reason code or record a new order (those are salesman actions); see the Supervisor/Management dashboards as a distinct role view |
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
| FR-31 | Every create, update and delete of a Transaksi, Customer, Salesman or User made through the app shall be recorded as an activity entry with the acting user, timestamp and field-level before→after values (names, not ids); an update that changes nothing records nothing; passwords are never recorded (only "changed"); entries survive deletion of the record and of the actor. Admin can see a record's own trail in its edit panel and all entries in Log Audit (filter by record type, search) | Given Admin changes a transaksi's note, then the transaksi's panel and Log Audit show "Diubah oleh <admin>" with `Catatan old → new`; given a user's password is reset, then the entry says only that the password changed |
| FR-32 | Admin shall be able to see the live status of the configured WAHA WhatsApp session (connected as which account / waiting for a QR scan / starting / not logged in / failed / WAHA unreachable / API key rejected / not configured) in Pengaturan → Koneksi WAHA, and to log the session in (WAHA creates or starts it and shows the QR to scan, refreshed automatically until scanned) and out (drops the linked WhatsApp login) — the same controls as the WAHA dashboard. Logout asks for an inline confirmation. Login on an already running session and logout on an already logged-out one change nothing. WAHA's own refusal message is shown. Only Admin can read the status or QR or change the session; the API key is never sent to the browser. | Given the session is stopped, when Admin presses Login, then a QR appears and, once scanned on the phone, the status turns to connected with the account name and number; given it is connected, when Admin confirms Logout, then the status turns to not logged in and Login is offered again; given WAHA is down, then the status says so and no Login/Logout is offered |
| FR-33 | Every reason a salesman gives for a late customer (BR-4) shall be recorded in the activity log on that customer, with the acting user, timestamp and the reason's label; when the reason also deactivates the customer, the status change is part of the same entry | Given a salesman picks "Kalah Harga" on a pending reminder, then the customer's panel and Log Audit show "Diubah oleh <salesman>" with `Alasan keterlambatan — → Kalah Harga`; given the reason is "Sudah Bangkrut", the same entry also shows `Status aktif → inactive` |
| FR-34 | The customer list and the customer edit panel shall show, read-only, the date of the customer's last transaksi and an order status — Overdue or On track — computed at read time by BR-1 and never stored | Given a 30-day cycle and a last order 30 days ago, then On track; 31 days ago, then Overdue; given the customer never ordered, then Overdue with no date |
| FR-35 | Admin shall set a customer Active or Inactive with the status toggle at the top of the edit panel (saved with Simpan); the change is recorded (FR-26, FR-31) and an Inactive customer gets no reminders (BR-2) | Given Admin switches the toggle to Inactive and saves, then the list shows Inactive and the panel's trail shows `Status aktif → inactive`; switching back to Aktif reverses it |
| FR-36 | Every record's edit panel (transaksi, customer, salesman, user) shall show "Aktivitas & komentar": the record's log entries and the comments people left on it in one list, newest first, a page at a time (10 per page). Whoever may open the panel may comment; a salesman may comment on their own customers. A comment is never edited or deleted | Given 14 entries on a customer, then page 1 shows the newest 10 and page 2 the other 4; given a comment is posted from page 2, then the list returns to page 1 with it on top |
| FR-37 | The reason a customer is late (FR-7) shall be given from the customer's panel, not from the salesman dashboard: on a late, active customer the comment box offers the reasons (optionally with a message); giving one is recorded as in FR-33 and ends the reminder's pending state as before. The dashboard shows the pending list and a link into the panel, and no reason buttons | Given a pending customer, when the salesman opens it from the dashboard and picks "Kalah Harga" with a message, then the customer's activity shows the reason and, above it, the message, and the customer leaves the pending list |
| FR-38 | Log Audit shall page all of its lists in the database — activity entries (with search and record-type filter), salesman moves and status changes — each with its own page control; no list is cut off at a fixed number of rows | Given 2,500 activity entries, then all can be reached page by page; given a search, then the page count follows the matches |
| FR-39 | The reminder text to a salesman shall read: a header with the salesman and the date ("🔔 Reminder Customer Anda [NAMA] — 22 Agu 2026"), the count, one numbered line per customer with the longest wait first ("1. NAMA — 151 hari (siklus normal 30 hari)"; a customer that never ordered is listed first as "belum pernah order"), and how to reply: press Balas (reply) on the message, then "number + reason" for one or several customers or the reason alone for all of them, choosing from the reasons on offer or writing their own. It is an editable template (`{{tanggal}}`, `{{daftar_alasan}}` added; `{{daftar_customer}}` is the numbered list) | Given three overdue customers with 151, 138 and 32 days, then the message lists them in that order with their own cycles and ends with the instructions and "Pilihan alasan: Kalah Harga / Stok Masih Ada / Sudah Bangkrut. Boleh juga menulis alasan Anda sendiri." |
| FR-40 | A salesman shall be able to answer a reminder by replying on WhatsApp. The system shall receive WhatsApp messages through the WAHA webhook, require the HMAC signature when a shared secret is set (the signature is optional: with no secret, unsigned calls are accepted), act only on text messages from a number that is a salesman's WhatsApp contact, and process each WhatsApp message once even if WAHA delivers it again | Given a known salesman's message, then it is processed; given the same message again, then nothing more happens; given a secret is set and the signature is bad or missing, then it is refused |
| FR-41 | A reply shall give a reason — one of the reasons on offer, or the salesman's own words — with a number from the reminder (`3 Kalah Harga`, `3 barang masih ada`; several: `1,2,5 …`, `1-3 …`, one per line). With no number the reason applies to every customer of that reminder still waiting. Free text is an answer only after a number, or when the message quotes (replies to) the reminder — then it also applies to every customer still waiting; free text with neither is not an answer. The reminder answered is the one quoted, else the newest with a customer still waiting. Each reason is recorded as in FR-33 ("… (via WhatsApp)"; a free-text reason is shown as written, counted under "Lainnya", and never deactivates), ends that customer's pending state, and the exact "Sudah Bangkrut" deactivates it. A number that is not in the list, already answered or no longer the salesman's records nothing and is reported | Given a reminder of 3 customers, then "2 Kalah Harga" records customer 2 only; "Barang masih ada" written as a reply to the reminder records all still waiting, and written without replying records nothing; given "1. Barang masih ada", then customer 1 shows "Barang masih ada (via WhatsApp)" |
| FR-42 | The system shall answer a known salesman's reply with a short confirmation (what was recorded, warnings, how many still wait) and, for text it does not understand, a how-to at most once an hour; it shall never answer a number that is not a salesman's, a group, or its own messages. This is not a reminder: FR-4 still holds for reminders | Given a recorded reply, then one confirmation is sent to that salesman; given two unrecognised messages within an hour, then only the first gets the how-to |
| FR-43 | Admin shall see every WhatsApp message received from a salesman's number, with its outcome (recorded, not understood, nothing waiting, not a salesman) and whether the confirmation was sent, in Log Audit, a page at a time; and shall set the webhook secret in Pengaturan → Koneksi WAHA | Given a reply that was not understood, then Log Audit lists it as "tidak dikenali" with the text the salesman wrote |
| FR-44 | A password an admin sets shall be at least 8 characters and never the published demo password. Demo accounts shall not exist in production: an empty production database gets one administrator from `ADMIN_PASSWORD` (none if it is missing or refused), and the login page shall not print the demo password there | Given a new user with the password "1234567", then it is refused; given an empty production database and no `ADMIN_PASSWORD`, then no account exists and the log says what to set |
| FR-45 | Pages shall carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (and HSTS in production); only a POST ends a session (a GET on `/logout` only redirects); the webhook shall refuse a body over 1 MB, keep no text from numbers that are not a salesman's, and keep only the latest 200 such messages and a salesman's messages for 180 days | Given a link to `/logout` on another page, then following it does not sign the user out |
| FR-46 | Admin shall be able to send a reminder again for one overdue, active customer from the customer's panel (⋮ → "Kirim pengingat kembali", after a confirmation): the usual reminder text as a list of one, to that customer's salesman only (no supervisor summary), as a run of its own on the dashboard, noted in the customer's activity. It needs `notification.manage`, is refused (nothing sent or written) for a customer that is inactive, not overdue, whose salesman has no WhatsApp number, or that was reminded within the last 10 minutes; if the message cannot be sent the run is voided and the reason shown. A customer's newest reminder is the one that counts for pending: answering it ends the wait even if an earlier reminder was never answered. This is an explicit Admin action, so FR-4 holds | Given an overdue customer whose salesman has a number, then Admin confirms and the salesman gets "Ada 1 customer …"; given the same customer again within 10 minutes, then it is refused with a message and nothing is sent |
| FR-47 | A salesman's WhatsApp number may be saved the way people write it ("0812-3456-7890", "+62 812 3456 7890", "62812…"); the system shall use it as WhatsApp needs it (country code 62, digits only) both when sending and when matching an incoming reply to the salesman, shall refuse or skip a number that cannot be one (fewer than 8 or more than 15 digits) with that number named, and shall keep WAHA's own explanation when a send fails | Given a number saved as "0812…", then the reminder is addressed to "62812…@c.us" and a reply from "62812…" is recognised as that salesman's; given the number "0812", then Admin is told it is not valid and nothing is sent |

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
| BR-11 | A salesman cannot be their own supervisor or (transitively) the supervisor of their own supervisor; a salesman who still has subordinates cannot be deleted (ADR-0004) | Assigning a supervisor; deleting a salesman |

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
| Session status/login while the session does not exist in WAHA | Status "Sesi belum dibuat"; Login creates it. Existence is read from WAHA's session list because WAHA answers 403 (not 404) for a missing session (FR-32) |
| Two admins press Login/Logout at once, or a stale page is used | Login on a running session and logout on a logged-out one are no-ops that just return the fresh status; the status re-reads itself every few seconds (FR-32) |
| The QR expires before it is scanned | WAHA issues a new one; the page picks it up on the next poll without a reload (FR-32) |

## Error handling

| Condition | User sees | System does |
|---|---|---|
| WAHA unreachable/timeout during trigger | Per-recipient failed/skipped counts, with a retry action | Records delivery failure; does not mark those customers notified |
| Excel file unreadable or wrong shape | Message explaining the expected template shape | Parses nothing, applies nothing, no preview shown |
| Import preview has unresolved unknown sheets and Admin confirms without the override | Message asking to resolve the sheet names first, or explicitly opt into "treat as new salesmen" | Import is refused, no data changed |
| Non-Admin attempts an Admin-only action | Action is not available/visible | Server-side check refuses it regardless of UI state (FR-27) |
| Session status/login/logout while WAHA is unreachable or rejects the API key | Status "WAHA tidak terjangkau" / "API key ditolak" with the reason; no Login/Logout offered | Nothing is sent to WAHA; reminders/tracking are unaffected (FR-29) |
| WAHA refuses a Login or Logout (e.g. 422) | WAHA's own message, status unchanged | Reports it; does not retry |

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
