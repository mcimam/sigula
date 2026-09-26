# ADR-0006 — Notifications and follow-ups: runs, items, derived "pending", versioned templates

| | |
|---|---|
| Status | accepted (release R3 implemented on branch `feat/erd-v2-foundation`; not deployed) |
| Date | 2026-09-26 |
| Deciders | User (chat: void a batch instead of deleting it; follow-up UI unchanged; only WhatsApp in the UI; templates for WhatsApp and email exist, email hidden) |
| Builds on | ADR-0002 (manual trigger), ADR-0004 (hierarchy), ADR-0005 (foundation) |

## Context

"Was this customer reminded?" was one boolean, `customers.notified`, flipped by four code paths
(send, retry, follow-up, order) and cleared by deleting a whole batch. It could not answer *which* message
covered a customer, kept no text, and a salesman had exactly one WhatsApp number in a column. Follow-ups were
`reason_logs` plus `customers.handled_on`, with the reason codes fixed by a CHECK.

## Decision

1. **Runs, deliveries, items.** `notification_runs` (one trigger; `manual` or `scheduled`; `as_of_date`;
   `finished_at`), `notification_deliveries` (one message to one recipient on one channel, with snapshots of
   the address, the template and the final text, a status, the provider's message id, `attempt`, `sent_at`) and
   `notification_items` (which customers the message covered, with the last-order date and days overdue at that
   moment). A supervisor's summary gets items too; only messages of kind `salesman` create pending.
2. **"Pending" is derived, not stored** (`pending.server.ts`). A customer is pending while it has an item on a
   *sent* salesman message of a *non-voided* run, with no `follow_ups` row pointing at the item, and whose last
   order date still equals the snapshot (a newer order ends it; an order older than the last one does not — the
   cycle did not restart). No flag to forget to clear.
3. **A batch is voided, never deleted** (`voided_at/by/reason`). Its reminders stop counting, so those customers
   can be reminded again. The old "delete batch" broke the rule that logs are immutable.
4. **A retry is a new delivery** (`attempt + 1`); the failed row stays as the record. The retry recomputes the
   list once for the whole pass: whoever was handled meanwhile is dropped, and a delivery left with nobody is not
   retried. (The old code re-sent an empty "0 customer" summary.)
5. **Contacts by channel.** `salesman_contacts` holds one live primary contact per (salesman, channel);
   `nomor_wa` moves there. Only WhatsApp has a sender (`ACTIVE_CHANNELS`) and a form field. A recipient without a
   contact gets a `skipped_no_contact` delivery (FR-17).
6. **Versioned templates.** `message_templates` per (code, channel), editable in Pengaturan → Template Pesan;
   saving inserts version n+1 and retires n, so a delivery keeps pointing at the text it sent. Placeholders are
   `{{nama}}`, `{{jumlah}}`, `{{daftar_customer}}`; unknown ones are rejected on save. Email templates are seeded
   (with a `subject`) but hidden and not editable, server-side too, until an email sender exists.
7. **Follow-ups.** `follow_ups` (outcome, reason, date, optional link to the reminder item) replaces
   `reason_logs` and `handled_on`; `follow_up_reasons` is a lookup (`deactivates_customer` makes "Sudah
   Bangkrut" inactive). The salesman UI is unchanged: the buttons now come from the lookup and always record
   `not_ordering`; `will_order` / `unreachable` exist in the schema without buttons.
8. The scheduler starts runs with `triggered_by_id = NULL, trigger = 'scheduled'` (it no longer borrows "the
   first admin"). `notification_deliveries.customer_count` is kept as a snapshot because pre-R3 rows have no items.
   `app_settings` gains `is_secret`, `updated_at`, `updated_by_id`.

## Consequences

- **Backfill (migration 0003).** Batches become runs with their ids (all `manual`, since a person was always
  recorded). A customer that is `notified` at migration time gets an item on its salesman's latest sent salesman
  message, so it stays pending; if that salesman has no sent delivery (inconsistent data) it simply becomes eligible
  again and is reminded at the next batch. `days_overdue` for those items is measured on the migration day. Legacy
  deliveries keep `customer_count` but have no items or text.
- The dashboard's "Hapus batch" is now "Batalkan batch" (with an optional reason); a voided run cannot be retried.
- **Amended 2026-09-26.** A message that was sent cannot be taken back, so voiding is now refused (`voidBatch`) for a
  run with any `sent` delivery, and the dashboard shows the button (now "Batalkan pengiriman") only for a run that
  delivered nothing. Voiding therefore no longer frees customers to be reminded again; that happens when the
  salesman gives a reason or a newer order arrives. Runs voided before this change keep their effect — the pending
  query still ignores voided runs. The dashboard says "pengiriman" for a run and "Perlu diingatkan" for eligible.
- `reason_logs` counts in the management dashboard and export now come from `follow_ups`.
- `pendingCustomerIds()` is one query per page/export; fine at pilot scale, an index on
  `notification_items(customer_id)` is in place for later.
- The "Ringkasan tim" text is now a template: editing it changes what supervisors receive.

## Alternatives rejected

- **Keep `customers.notified` as a cache** — reintroduces the flag-drift this fixes.
- **Delete a batch (status quo)** — see 3.
- **Overwrite a template in place** — old deliveries would point at text they never sent.

## Verification

`tests/reminders.test.ts` (rewritten: items and snapshots, the ways pending ends, retry attempts and recompute,
void, scheduler runs, follow-ups), `tests/templates.test.ts`, `tests/contacts.test.ts`, migration 0003 backfill in
`tests/migrations.test.ts` (with two deliberate breakages that the tests caught), and an end-to-end pass over HTTP
on a copy of the development database (template edit and rejection, trigger, retry, void, salesman follow-up).
