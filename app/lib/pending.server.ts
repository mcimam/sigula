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
 *    the one the message was made with).
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
    AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.notification_item_id = i.id)`;

export function pendingCustomerIds(): Set<number> {
  const rows = db.all<{ customer_id: number }>(sql`SELECT DISTINCT i.customer_id ${PENDING_ITEMS}`);
  return new Set(rows.map((r) => r.customer_id));
}

/** The newest still-pending item of a customer — what a follow-up should point at. */
export function pendingItemId(customerId: number): number | null {
  const row = db.get<{ id: number }>(
    sql`SELECT i.id ${PENDING_ITEMS} AND i.customer_id = ${customerId} ORDER BY i.id DESC LIMIT 1`,
  );
  return row?.id ?? null;
}
