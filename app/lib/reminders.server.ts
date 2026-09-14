import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  customers,
  notificationBatches,
  notificationDeliveries,
  reasonLogs,
  salesmen,
  statusLogs,
  supervisors,
  type ReasonCode,
} from "~/db/schema";
import { todayIso } from "~/lib/dates";
import { notYetNotifiedEligible } from "~/lib/orders.server";
import { createWahaClient, type WahaClient } from "~/lib/waha.server";

export function eligibleCustomerCount(today = todayIso()) {
  return notYetNotifiedEligible(today).length;
}

export function previewBatch(today = todayIso()) {
  const eligible = notYetNotifiedEligible(today);
  const bySalesman = new Map<number, typeof eligible>();
  for (const c of eligible) {
    const list = bySalesman.get(c.salesmanId) ?? [];
    list.push(c);
    bySalesman.set(c.salesmanId, list);
  }

  const salesmanRows = [...bySalesman.keys()].map((id) => {
    const salesman = db.select().from(salesmen).where(eq(salesmen.id, id)).get()!;
    return { salesman, customers: bySalesman.get(id)! };
  });

  const supervisorIds = new Set(
    salesmanRows
      .map((s) => s.salesman.supervisorId)
      .filter((id): id is number => id != null),
  );

  const supervisorRows = [...supervisorIds].map((id) => {
    const supervisor = db
      .select()
      .from(supervisors)
      .where(eq(supervisors.id, id))
      .get()!;
    const teamCustomers = eligible.filter((c) => {
      const sm = salesmanRows.find((s) => s.salesman.id === c.salesmanId)?.salesman;
      return sm?.supervisorId === id;
    });
    return { supervisor, customers: teamCustomers };
  });

  return { salesmen: salesmanRows, supervisors: supervisorRows };
}

export async function triggerBatch(opts: {
  triggeredById: number;
  client?: WahaClient;
  today?: string;
}) {
  const today = opts.today ?? todayIso();
  const client = opts.client ?? createWahaClient();
  const preview = previewBatch(today);
  if (preview.salesmen.length === 0) return null;

  const batch = db
    .insert(notificationBatches)
    .values({
      triggeredById: opts.triggeredById,
      // Explicit value — Drizzle+SQLite mishandles sql`(datetime('now'))`
      // defaults on INSERT (emits a failing `null, datetime('now'), ?` row).
      tanggal: new Date().toISOString().slice(0, 19).replace("T", " "),
    })
    .returning()
    .get();

  for (const row of preview.salesmen) {
    await deliverToSalesman(client, batch.id, row.salesman, row.customers);
  }
  for (const row of preview.supervisors) {
    await deliverToSupervisor(client, batch.id, row.supervisor, row.customers);
  }
  return batch;
}

export async function retryBatch(opts: {
  batchId: number;
  client?: WahaClient;
  today?: string;
}) {
  const today = opts.today ?? todayIso();
  const client = opts.client ?? createWahaClient();
  const failed = db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.batchId, opts.batchId),
        eq(notificationDeliveries.status, "failed"),
      ),
    )
    .all();

  for (const delivery of failed) {
    await retryDelivery(client, delivery, today);
  }
  return db
    .select()
    .from(notificationBatches)
    .where(eq(notificationBatches.id, opts.batchId))
    .get();
}

/**
 * Delete a batch and its deliveries.
 * Clears `notified` for customers of salesmen that appeared in this batch,
 * so admin can re-trigger after removing a mistaken / failed send.
 */
export function deleteBatch(batchId: number) {
  const batch = db
    .select()
    .from(notificationBatches)
    .where(eq(notificationBatches.id, batchId))
    .get();
  if (!batch) throw new Error("Batch not found");

  const salesmanIds = db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.batchId, batchId))
    .all()
    .map((d) => d.salesmanId)
    .filter((id): id is number => id != null);

  if (salesmanIds.length > 0) {
    const affected = db
      .select()
      .from(customers)
      .where(inArray(customers.salesmanId, salesmanIds))
      .all()
      .filter((c) => c.notified);
    if (affected.length > 0) {
      db.update(customers)
        .set({ notified: false })
        .where(
          inArray(
            customers.id,
            affected.map((c) => c.id),
          ),
        )
        .run();
    }
  }

  db.delete(notificationDeliveries)
    .where(eq(notificationDeliveries.batchId, batchId))
    .run();
  db.delete(notificationBatches)
    .where(eq(notificationBatches.id, batchId))
    .run();
}

async function deliverToSalesman(
  client: WahaClient,
  batchId: number,
  salesman: typeof salesmen.$inferSelect,
  list: ReturnType<typeof notYetNotifiedEligible>,
) {
  if (!salesman.nomorWa) {
    db.insert(notificationDeliveries)
      .values({
        batchId,
        salesmanId: salesman.id,
        customerCount: list.length,
        status: "skipped_no_phone",
      })
      .run();
    return;
  }

  const result = await client.sendText(
    salesman.nomorWa,
    salesmanMessage(salesman.nama, list),
  );
  if (result.ok) {
    if (list.length > 0) {
      db.update(customers)
        .set({ notified: true })
        .where(
          inArray(
            customers.id,
            list.map((c) => c.id),
          ),
        )
        .run();
    }
  }
  db.insert(notificationDeliveries)
    .values({
      batchId,
      salesmanId: salesman.id,
      customerCount: list.length,
      status: result.ok ? "sent" : "failed",
      errorMessage: result.errorMessage ?? "",
    })
    .run();
}

async function deliverToSupervisor(
  client: WahaClient,
  batchId: number,
  supervisor: typeof supervisors.$inferSelect,
  list: ReturnType<typeof notYetNotifiedEligible>,
) {
  if (!supervisor.nomorWa) {
    db.insert(notificationDeliveries)
      .values({
        batchId,
        supervisorId: supervisor.id,
        customerCount: list.length,
        status: "skipped_no_phone",
      })
      .run();
    return;
  }

  const result = await client.sendText(
    supervisor.nomorWa,
    supervisorMessage(supervisor.nama, list.length),
  );
  db.insert(notificationDeliveries)
    .values({
      batchId,
      supervisorId: supervisor.id,
      customerCount: list.length,
      status: result.ok ? "sent" : "failed",
      errorMessage: result.errorMessage ?? "",
    })
    .run();
}

async function retryDelivery(
  client: WahaClient,
  delivery: typeof notificationDeliveries.$inferSelect,
  today: string,
) {
  const eligible = notYetNotifiedEligible(today);
  let list = eligible;
  let nomorWa = "";
  let message = "";

  if (delivery.salesmanId) {
    const salesman = db
      .select()
      .from(salesmen)
      .where(eq(salesmen.id, delivery.salesmanId))
      .get()!;
    list = eligible.filter((c) => c.salesmanId === salesman.id);
    nomorWa = salesman.nomorWa;
    message = salesmanMessage(salesman.nama, list);
  } else if (delivery.supervisorId) {
    const supervisor = db
      .select()
      .from(supervisors)
      .where(eq(supervisors.id, delivery.supervisorId))
      .get()!;
    const teamSalesmanIds = db
      .select()
      .from(salesmen)
      .where(eq(salesmen.supervisorId, supervisor.id))
      .all()
      .map((s) => s.id);
    list = eligible.filter((c) => teamSalesmanIds.includes(c.salesmanId));
    nomorWa = supervisor.nomorWa;
    message = supervisorMessage(supervisor.nama, list.length);
  }

  if (!nomorWa) {
    db.update(notificationDeliveries)
      .set({
        customerCount: list.length,
        status: "skipped_no_phone",
        errorMessage: "",
      })
      .where(eq(notificationDeliveries.id, delivery.id))
      .run();
    return;
  }

  const result = await client.sendText(nomorWa, message);
  if (result.ok && delivery.salesmanId && list.length > 0) {
    db.update(customers)
      .set({ notified: true })
      .where(
        inArray(
          customers.id,
          list.map((c) => c.id),
        ),
      )
      .run();
  }
  db.update(notificationDeliveries)
    .set({
      customerCount: list.length,
      status: result.ok ? "sent" : "failed",
      errorMessage: result.errorMessage ?? "",
    })
    .where(eq(notificationDeliveries.id, delivery.id))
    .run();
}

function salesmanMessage(
  nama: string,
  list: { nama: string }[],
) {
  const names = list.map((c) => c.nama).join(", ");
  return `Halo ${nama}, ada ${list.length} customer yang sudah melewati siklus order dan perlu ditindaklanjuti: ${names}.`;
}

function supervisorMessage(nama: string, count: number) {
  return `Ringkasan tim ${nama}: ${count} customer overdue perlu ditindaklanjuti.`;
}

export function submitReason(opts: {
  customerId: number;
  kodeAlasan: ReasonCode;
  actingUserId: number;
}) {
  return db.transaction((tx) => {
    const customer = tx
      .select()
      .from(customers)
      .where(eq(customers.id, opts.customerId))
      .get();
    if (!customer) throw new Error("Customer not found");

    tx.insert(reasonLogs)
      .values({
        customerId: customer.id,
        salesmanId: customer.salesmanId,
        kodeAlasan: opts.kodeAlasan,
      })
      .run();

    if (opts.kodeAlasan === "3") {
      tx.update(customers)
        .set({
          handledOn: todayIso(),
          notified: false,
          statusCustomer: "inactive",
        })
        .where(eq(customers.id, customer.id))
        .run();
      tx.insert(statusLogs)
        .values({
          customerId: customer.id,
          tipe: "manual_inactive",
          olehId: opts.actingUserId,
        })
        .run();
    } else {
      tx.update(customers)
        .set({ handledOn: todayIso(), notified: false })
        .where(eq(customers.id, customer.id))
        .run();
    }
  });
}
