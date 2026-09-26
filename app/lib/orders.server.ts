import { desc, eq, max } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, salesmen, statusLogs, transaksi } from "~/db/schema";
import { diffChanges, logActivity, snapshotChanges } from "~/lib/activity.server";
import { isOverdue, todayIso } from "~/lib/dates";

const customerName = (id: number) =>
  db.select({ n: customers.nama }).from(customers).where(eq(customers.id, id)).get()?.n ??
  `#${id}`;
const salesmanName = (id: number) =>
  db.select({ n: salesmen.nama }).from(salesmen).where(eq(salesmen.id, id)).get()?.n ??
  `#${id}`;

/** Human-readable field values for the activity trail (names, not ids). */
function transaksiFields(row: {
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

/** BR-2: Active + overdue (includes already-notified — dashboards use this). */
export function computeEligibleCustomers(today = todayIso()) {
  const rows = db
    .select()
    .from(customers)
    .where(eq(customers.statusCustomer, "aktif"))
    .all();
  return rows.filter((c) =>
    isOverdue(c.lastOrderDate, c.orderCycleDays, today),
  );
}

/** FR-3 narrowing for trigger/preview/retry — exclude already-notified. */
export function notYetNotifiedEligible(today = todayIso()) {
  return computeEligibleCustomers(today).filter((c) => !c.notified);
}

export function eligibleCustomerCount(today = todayIso()) {
  return notYetNotifiedEligible(today).length;
}

/** Recompute customer.last_order_date from transaksi (max tanggal). */
export function syncCustomerLastOrderDate(customerId: number) {
  const row = db
    .select({ latest: max(transaksi.tanggalOrder) })
    .from(transaksi)
    .where(eq(transaksi.customerId, customerId))
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
}) {
  const tanggalOrder = opts.tanggalOrder ?? todayIso();
  const sumber = opts.sumber ?? "manual";

  const result = db.transaction((tx) => {
    const customer = tx
      .select()
      .from(customers)
      .where(eq(customers.id, opts.customerId))
      .get();
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
      })
      .returning()
      .get();

    const latestRow = tx
      .select({ latest: max(transaksi.tanggalOrder) })
      .from(transaksi)
      .where(eq(transaksi.customerId, customer.id))
      .get();
    const latest = latestRow?.latest ?? tanggalOrder;

    tx.update(customers)
      .set({
        lastOrderDate: latest,
        statusCustomer: "aktif",
        handledOn: null,
        notified: false,
      })
      .where(eq(customers.id, customer.id))
      .run();

    if (wasInactive) {
      tx.insert(statusLogs)
        .values({
          customerId: customer.id,
          tipe: "auto_reactivation",
          olehId: opts.actingUserId,
        })
        .run();
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
    .where(eq(transaksi.id, opts.id))
    .get();
  if (!existing) throw new Error("Transaksi not found");

  const oldCustomerId = existing.customerId;
  const before = transaksiFields(existing);

  db.update(transaksi)
    .set({
      customerId: opts.customerId,
      salesmanId: opts.salesmanId,
      tanggalOrder: opts.tanggalOrder,
      catatan: opts.catatan ?? existing.catatan,
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

export function deleteTransaksi(id: number, actingUserId?: number | null) {
  const existing = db
    .select()
    .from(transaksi)
    .where(eq(transaksi.id, id))
    .get();
  if (!existing) throw new Error("Transaksi not found");
  // Snapshot before the row (and possibly its customer's name) goes away.
  const label = transaksiLabel(existing);
  const fields = transaksiFields(existing);
  db.delete(transaksi).where(eq(transaksi.id, id)).run();
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
