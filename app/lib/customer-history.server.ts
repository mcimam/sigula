import { and, count, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { db, type DbHandle } from "~/db/client.server";
import { customerAssignments, customerStatusHistory } from "~/db/schema";
import { nowIso } from "~/lib/dates";
import { pageWindow } from "~/lib/pagination";

/**
 * Append-only history of a customer (ERD D7): who held it, and which state it
 * was in. Nothing here is ever deleted or edited, except that `valid_to` of an
 * assignment is filled once when the customer moves on. `customers.salesman_id`
 * and `customers.status_customer` stay as the fast current-state copy; write
 * both in the same transaction.
 */
export type StatusReason = "manual_inactive" | "manual_reactivation" | "auto_reactivation";

/** First assignment of a new customer. Call in the transaction that inserts the customer. */
export function openAssignment(
  h: DbHandle,
  opts: {
    customerId: number;
    salesmanId: number;
    assignedById?: number | null;
    note?: string;
    at?: string;
  },
) {
  h.insert(customerAssignments)
    .values({
      customerId: opts.customerId,
      salesmanId: opts.salesmanId,
      validFrom: opts.at ?? nowIso(),
      assignedById: opts.assignedById ?? null,
      note: opts.note ?? "",
    })
    .run();
}

/** Ends the customer's open assignment and opens the next one at the same instant. */
export function moveAssignment(
  h: DbHandle,
  opts: { customerId: number; toSalesmanId: number; assignedById: number | null; at?: string },
) {
  const at = opts.at ?? nowIso();
  h.update(customerAssignments)
    .set({ validTo: at })
    .where(
      and(
        eq(customerAssignments.customerId, opts.customerId),
        isNull(customerAssignments.validTo),
      ),
    )
    .run();
  openAssignment(h, {
    customerId: opts.customerId,
    salesmanId: opts.toSalesmanId,
    assignedById: opts.assignedById,
    at,
  });
}

/**
 * A customer changing hands, newest first, one page at a time — what the audit page
 * lists. A move is an assignment that took over from an earlier one (ended exactly
 * when this began); a customer's first assignment is not a move.
 */
export function listAssignmentMovesPage(requestedPage: number, pageSize: number) {
  const isMove = sql`EXISTS (
    SELECT 1 FROM customer_assignments AS earlier
    WHERE earlier.customer_id = ${customerAssignments.customerId}
      AND earlier.valid_to = ${customerAssignments.validFrom}
      AND earlier.id < ${customerAssignments.id})`;
  const total = db.select({ n: count() }).from(customerAssignments).where(isMove).get()!.n;
  const { page, totalPages, offset } = pageWindow(total, requestedPage, pageSize);
  const rows = db
    .select()
    .from(customerAssignments)
    .where(isMove)
    .orderBy(desc(customerAssignments.id))
    .limit(pageSize)
    .offset(offset)
    .all();
  const moves = rows.map((row) => {
    // The previous holder is the assignment that ended exactly when this one began.
    const previous = db
      .select()
      .from(customerAssignments)
      .where(
        and(
          eq(customerAssignments.customerId, row.customerId),
          eq(customerAssignments.validTo, row.validFrom),
          lt(customerAssignments.id, row.id),
        ),
      )
      .orderBy(desc(customerAssignments.id))
      .get()!;
    return {
      id: row.id,
      customerId: row.customerId,
      fromSalesmanId: previous.salesmanId,
      toSalesmanId: row.salesmanId,
      at: row.validFrom,
      byId: row.assignedById,
    };
  });
  return { rows: moves, total, page, totalPages, pageSize };
}

/** One active↔inactive transition of a customer. `changedById` null = the system did it. */
export function recordStatusChange(
  h: DbHandle,
  opts: {
    customerId: number;
    from: "aktif" | "inactive";
    to: "aktif" | "inactive";
    reason: StatusReason;
    changedById: number | null;
  },
) {
  h.insert(customerStatusHistory)
    .values({
      customerId: opts.customerId,
      fromStatus: opts.from,
      toStatus: opts.to,
      reason: opts.reason,
      changedById: opts.changedById,
    })
    .run();
}

/** Active↔inactive transitions, newest first, one page at a time — what the audit page lists. */
export function listStatusChangesPage(requestedPage: number, pageSize: number) {
  const total = db.select({ n: count() }).from(customerStatusHistory).get()!.n;
  const { page, totalPages, offset } = pageWindow(total, requestedPage, pageSize);
  const rows = db
    .select()
    .from(customerStatusHistory)
    .orderBy(desc(customerStatusHistory.id))
    .limit(pageSize)
    .offset(offset)
    .all();
  return { rows, total, page, totalPages, pageSize };
}
