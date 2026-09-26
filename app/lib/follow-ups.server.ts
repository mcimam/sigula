import { and, asc, count, eq, ne } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, followUpReasons, followUps } from "~/db/schema";
import { logActivity } from "~/lib/activity.server";
import { recordStatusChange } from "~/lib/customer-history.server";
import { todayIso } from "~/lib/dates";
import { findLiveCustomer } from "~/lib/masterdata.server";
import { pendingItemId } from "~/lib/pending.server";
import { clipReasonText, OTHER_REASON_CODE } from "~/lib/reasons";

/**
 * What a salesman did about an overdue customer (`follow_ups`) and the reasons
 * they can pick (`follow_up_reasons`, a lookup admins can extend). Replaces
 * `reason_logs` and `customers.handled_on`.
 * DEBT-015: only the `not_ordering` outcome is recorded; `will_order` and
 * `unreachable` have no UI yet.
 */

/**
 * Reasons offered in the UI and named in the reminder, in display order. The "Lainnya" reason
 * (a salesman's own words) is not among them: it is never a choice, only what a free-text answer
 * is recorded as. `reasonCounts` and `findFollowUpReason` do see it.
 */
export function listFollowUpReasons() {
  return db
    .select()
    .from(followUpReasons)
    .where(and(eq(followUpReasons.isActive, true), ne(followUpReasons.code, OTHER_REASON_CODE)))
    .orderBy(asc(followUpReasons.sortOrder), asc(followUpReasons.id))
    .all();
}

export function findFollowUpReason(code: string) {
  return db
    .select()
    .from(followUpReasons)
    .where(and(eq(followUpReasons.code, code), eq(followUpReasons.isActive, true)))
    .get();
}

/**
 * The salesman says why a customer is not reordering (BR-4). The follow-up is
 * linked to the reminder that prompted it, which ends that reminder's
 * "pending"; a reason that deactivates the customer (e.g. "Sudah Bangkrut")
 * also marks it inactive. Every reason is written to the activity log on the
 * customer (who said what), together with the status change if there was one.
 * The salesman's own words (`OTHER_REASON_CODE`) are the reason itself: `note` is required,
 * is what the activity shows, and never deactivates. For an offered reason `note` is an
 * optional remark, kept with the follow-up. Throws `Alasan tidak valid` for an unknown code.
 */
export function submitReason(opts: {
  customerId: number;
  kodeAlasan: string;
  /** The user who gave it; null when a salesman without a login answered by WhatsApp. */
  actingUserId: number | null;
  /** Where it came from, shown next to the reason in the activity ("Kalah Harga (via WhatsApp)"). */
  via?: string;
  /** Free text: the reason itself for "Lainnya", else a remark. */
  note?: string;
}) {
  const reason = findFollowUpReason(opts.kodeAlasan);
  if (!reason) throw new Error("Alasan tidak valid");
  const note = clipReasonText(opts.note ?? "");
  const own = reason.code === OTHER_REASON_CODE;
  if (own && !note) throw new Error("Alasan lain perlu diisi");
  const shown = own ? note : reason.label;

  const { customer, deactivated } = db.transaction((tx) => {
    const found = findLiveCustomer(opts.customerId);
    if (!found) throw new Error("Customer not found");

    tx.insert(followUps)
      .values({
        customerId: found.id,
        salesmanId: found.salesmanId,
        notificationItemId: pendingItemId(found.id),
        outcome: "not_ordering",
        reasonId: reason.id,
        note,
        followUpDate: todayIso(),
        createdById: opts.actingUserId,
      })
      .run();

    const deactivate = reason.deactivatesCustomer && found.statusCustomer !== "inactive";
    if (deactivate) {
      tx.update(customers).set({ statusCustomer: "inactive" }).where(eq(customers.id, found.id)).run();
      recordStatusChange(tx, {
        customerId: found.id,
        from: "aktif",
        to: "inactive",
        reason: "manual_inactive",
        changedById: opts.actingUserId,
      });
    }
    return { customer: found, deactivated: deactivate };
  });

  logActivity({
    entityType: "customer",
    entityId: customer.id,
    entityLabel: customer.nama,
    action: "update",
    actorId: opts.actingUserId,
    changes: {
      alasan_keterlambatan: { from: null, to: opts.via ? `${shown} (via ${opts.via})` : shown },
      ...(deactivated ? { status_customer: { from: "aktif", to: "inactive" } } : {}),
    },
  });
}

/** Every reason (also retired ones, so old follow-ups still add up) with how often it was chosen. */
export function reasonCounts() {
  return db
    .select({
      code: followUpReasons.code,
      label: followUpReasons.label,
      count: count(followUps.id),
    })
    .from(followUpReasons)
    .leftJoin(followUps, eq(followUps.reasonId, followUpReasons.id))
    .groupBy(followUpReasons.id)
    .orderBy(asc(followUpReasons.sortOrder), asc(followUpReasons.id))
    .all();
}

/** How many follow-ups each salesman has recorded, all time. */
export function followUpCountBySalesman() {
  return new Map(
    db
      .select({ salesmanId: followUps.salesmanId, n: count() })
      .from(followUps)
      .groupBy(followUps.salesmanId)
      .all()
      .map((r) => [r.salesmanId, r.n]),
  );
}
