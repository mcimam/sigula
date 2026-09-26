import { and, desc, eq, max } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, customers, transaksi } from "~/db/schema";
import { diffChanges, logActivity, snapshotChanges } from "~/lib/activity.server";
import { recordStatusChange } from "~/lib/customer-history.server";
import { findLiveCustomer, findLiveSalesman } from "~/lib/masterdata.server";
import { customerName, salesmanName } from "~/lib/names.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import { isOverdue, nowIso, todayIso } from "~/lib/dates";

/** Human-readable field values for the activity trail (names, not ids). */
export function transaksiFields(row: {
  customerId: number;
  salesmanId: number;
  tanggalOrder: string;
  catatan: string | null;
  sumber?: string;
}) {
  return {
    customer: customerName(row.customerId),
    salesman: salesmanName(row.salesmanId),
    tanggal_order: row.tanggalOrder,
    catatan: row.catatan,
    ...(row.sumber ? { sumber: row.sumber } : {}),
  };
}

const transaksiLabel = (row: { customerId: number; tanggalOrder: string }) =>
  `${customerName(row.customerId)} · ${row.tanggalOrder}`;

/** A transaksi may only point at a live customer and a live salesman. */
export function assertLiveParents(customerId: number, salesmanId: number) {
  if (!findLiveCustomer(customerId)) {
    throw new Error(`Customer ${customerName(customerId)} tidak ditemukan atau sudah dihapus`);
  }
  if (!findLiveSalesman(salesmanId)) {
    throw new Error(`Salesman ${salesmanName(salesmanId)} tidak ditemukan atau sudah dihapus`);
  }
}

/** BR-2: Active + overdue (includes already-pending — dashboards use this). */
export function computeEligibleCustomers(today = todayIso()) {
  const rows = db
    .select()
    .from(customers)
    .where(and(eq(customers.statusCustomer, "aktif"), alive(customers)))
    .all();
  return rows.filter((c) =>
    isOverdue(c.lastOrderDate, c.orderCycleDays, today),
  );
}

/** FR-3 narrowing for trigger/preview/retry — exclude customers that are already pending. */
export function notYetNotifiedEligible(today = todayIso()) {
  const pending = pendingCustomerIds();
  return computeEligibleCustomers(today).filter((c) => !pending.has(c.id));
}

/** Recompute customer.last_order_date from live transaksi (max tanggal). */
export function syncCustomerLastOrderDate(customerId: number) {
  const row = db
    .select({ latest: max(transaksi.tanggalOrder) })
    .from(transaksi)
    .where(and(eq(transaksi.customerId, customerId), alive(transaksi)))
    .get();
  const latest = row?.latest ?? null;
  db.update(customers)
    .set({ lastOrderDate: latest })
    .where(eq(customers.id, customerId))
    .run();
  return latest;
}

export function recordOrder(opts: {
  customerId: number;
  actingUserId: number | null;
  tanggalOrder?: string;
  sumber?: "seed" | "import" | "manual";
  salesmanId?: number;
  catatan?: string;
  /** Set for rows that come from an Excel import (`import_batches`). */
  importBatchId?: number;
}) {
  const tanggalOrder = opts.tanggalOrder ?? todayIso();
  const sumber = opts.sumber ?? "manual";

  const result = db.transaction((tx) => {
    const customer = findLiveCustomer(opts.customerId);
    if (!customer) throw new Error(`Customer ${opts.customerId} not found`);

    const wasInactive = customer.statusCustomer === "inactive";
    const salesmanId = opts.salesmanId ?? customer.salesmanId;

    const inserted = tx
      .insert(transaksi)
      .values({
        customerId: customer.id,
        salesmanId,
        tanggalOrder,
        sumber,
        catatan: opts.catatan ?? "",
        importBatchId: opts.importBatchId ?? null,
        createdById: opts.actingUserId,
        updatedById: opts.actingUserId,
      })
      .returning()
      .get();

    const latestRow = tx
      .select({ latest: max(transaksi.tanggalOrder) })
      .from(transaksi)
      .where(and(eq(transaksi.customerId, customer.id), alive(transaksi)))
      .get();
    const latest = latestRow?.latest ?? tanggalOrder;

    tx.update(customers)
      .set({
        lastOrderDate: latest,
        statusCustomer: "aktif",
      })
      .where(eq(customers.id, customer.id))
      .run();

    if (wasInactive) {
      recordStatusChange(tx, {
        customerId: customer.id,
        from: "inactive",
        to: "aktif",
        reason: "auto_reactivation",
        changedById: opts.actingUserId,
      });
    }

    return {
      customerId: customer.id,
      tanggalOrder,
      reactivated: wasInactive,
      inserted,
    };
  });

  logActivity({
    entityType: "transaksi",
    entityId: result.inserted.id,
    entityLabel: transaksiLabel(result.inserted),
    action: "create",
    actorId: opts.actingUserId,
    changes: snapshotChanges(transaksiFields(result.inserted), "create"),
  });
  if (result.reactivated) {
    logActivity({
      entityType: "customer",
      entityId: result.customerId,
      entityLabel: customerName(result.customerId),
      action: "update",
      actorId: opts.actingUserId,
      changes: { status_customer: { from: "inactive", to: "aktif" } },
    });
  }
  return {
    customerId: result.customerId,
    tanggalOrder: result.tanggalOrder,
    reactivated: result.reactivated,
  };
}

export function listTransaksi(limit = 200) {
  return db
    .select()
    .from(transaksi)
    .where(alive(transaksi))
    .orderBy(desc(transaksi.id))
    .limit(limit)
    .all();
}

export function createTransaksi(opts: {
  customerId: number;
  salesmanId: number;
  tanggalOrder: string;
  sumber?: "seed" | "import" | "manual";
  catatan?: string;
  actingUserId: number | null;
}) {
  assertLiveParents(opts.customerId, opts.salesmanId);
  return recordOrder({
    customerId: opts.customerId,
    salesmanId: opts.salesmanId,
    tanggalOrder: opts.tanggalOrder,
    sumber: opts.sumber ?? "manual",
    catatan: opts.catatan,
    actingUserId: opts.actingUserId,
  });
}

export function updateTransaksi(opts: {
  id: number;
  customerId: number;
  salesmanId: number;
  tanggalOrder: string;
  catatan?: string;
  actingUserId?: number | null;
}) {
  const existing = db
    .select()
    .from(transaksi)
    .where(and(eq(transaksi.id, opts.id), alive(transaksi)))
    .get();
  if (!existing) throw new Error("Transaksi not found");
  assertLiveParents(opts.customerId, opts.salesmanId);

  const oldCustomerId = existing.customerId;
  const before = transaksiFields(existing);

  db.update(transaksi)
    .set({
      customerId: opts.customerId,
      salesmanId: opts.salesmanId,
      tanggalOrder: opts.tanggalOrder,
      catatan: opts.catatan ?? existing.catatan,
      updatedById: opts.actingUserId ?? null,
    })
    .where(eq(transaksi.id, opts.id))
    .run();

  syncCustomerLastOrderDate(opts.customerId);
  if (oldCustomerId !== opts.customerId) {
    syncCustomerLastOrderDate(oldCustomerId);
  }

  const updated = db.select().from(transaksi).where(eq(transaksi.id, opts.id)).get()!;
  logActivity({
    entityType: "transaksi",
    entityId: opts.id,
    entityLabel: transaksiLabel(updated),
    action: "update",
    actorId: opts.actingUserId,
    changes: diffChanges(before, transaksiFields(updated)),
  });
}

/** Soft delete (ADR-0005): the row stays, hidden, and `restoreTransaksi` brings it back. */
export function deleteTransaksi(id: number, actingUserId?: number | null) {
  const existing = db
    .select()
    .from(transaksi)
    .where(and(eq(transaksi.id, id), alive(transaksi)))
    .get();
  if (!existing) throw new Error("Transaksi not found");
  const label = transaksiLabel(existing);
  const fields = transaksiFields(existing);
  db.update(transaksi)
    .set({ deletedAt: nowIso(), deletedById: actingUserId ?? null })
    .where(eq(transaksi.id, id))
    .run();
  syncCustomerLastOrderDate(existing.customerId);
  logActivity({
    entityType: "transaksi",
    entityId: id,
    entityLabel: label,
    action: "delete",
    actorId: actingUserId,
    changes: snapshotChanges(fields, "delete"),
  });
}

export function deleteTransaksiMany(ids: number[], actingUserId?: number | null) {
  for (const id of ids) {
    deleteTransaksi(id, actingUserId);
  }
}
