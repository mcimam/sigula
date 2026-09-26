import { sql } from "drizzle-orm";

import { db } from "~/db/client.server";

/**
 * "Pending" = reminded, waiting for the salesman. It replaces the old
 * `customers.notified` flag and is derived, never stored (ERD D8), so there is
 * no flag to forget to clear. A customer is pending while it has a
 * notification item that is:
 *  - on a message of kind `salesman` that was actually sent (a supervisor's
 *    summary says nothing about the customer's own follow-up),
 *  - on a run that has not been voided,
 *  - not yet followed up (no `follow_ups` row points at the item), and
 *  - not overtaken by a newer order (the customer's last order date is still
 *    the one the message was made with), and
 *  - the customer's newest such item: a reminder sent again (Admin's "Kirim pengingat
 *    kembali") replaces the earlier one, so answering the newest ends the wait — the
 *    older, unanswered item does not keep the customer pending.
 * A deleted customer is never pending.
 */
const PENDING_ITEMS = sql`
  FROM notification_items i
  JOIN notification_deliveries d ON d.id = i.delivery_id
  JOIN notification_runs r ON r.id = d.run_id
  JOIN customers c ON c.id = i.customer_id
  WHERE d.status = 'sent'
    AND d.recipient_kind = 'salesman'
    AND r.voided_at IS NULL
    AND c.deleted_at IS NULL
    AND c.last_order_date IS i.last_order_date
    AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.notification_item_id = i.id)
    AND i.id = (
      SELECT max(i2.id) FROM notification_items i2
      JOIN notification_deliveries d2 ON d2.id = i2.delivery_id
      JOIN notification_runs r2 ON r2.id = d2.run_id
      WHERE i2.customer_id = i.customer_id
        AND d2.status = 'sent' AND d2.recipient_kind = 'salesman' AND r2.voided_at IS NULL)`;

export function pendingCustomerIds(): Set<number> {
  const rows = db.all<{ customer_id: number }>(sql`SELECT DISTINCT i.customer_id ${PENDING_ITEMS}`);
  return new Set(rows.map((r) => r.customer_id));
}

/** The customer's pending item — the newest reminder, what a follow-up should point at. */
export function pendingItemId(customerId: number): number | null {
  const row = db.get<{ id: number }>(
    sql`SELECT i.id ${PENDING_ITEMS} AND i.customer_id = ${customerId} ORDER BY i.id DESC LIMIT 1`,
  );
  return row?.id ?? null;
}
