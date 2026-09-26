import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, salesmen, transaksi, users } from "~/db/schema";
import { logActivity, snapshotChanges } from "~/lib/activity.server";
import { attachWhatsapp } from "~/lib/contacts.server";
import {
  assertCustomerNameFree,
  assertUsernameFree,
  customerFields,
  findLiveSalesman,
  salesmanFields,
  userFields,
} from "~/lib/masterdata.server";
import { customerName, salesmanName } from "~/lib/names.server";
import { roleNamesOf, rolesForUsers } from "~/lib/roles.server";
import { assertLiveParents, syncCustomerLastOrderDate, transaksiFields } from "~/lib/orders.server";

/**
 * Soft-deleted master data and transaksi (ADR-0005): what is in the "Terhapus"
 * views, and how a row comes back. A restore refuses — with a message saying
 * what to restore first — whenever it would leave a live row pointing at a
 * deleted one, so the invariant "live rows only reference live rows" holds.
 * DEBT-013: nothing here purges a soft-deleted row for good.
 */

// ───────────────────────────────── listing ─────────────────────────────────

/** Rows in each "Terhapus" view — the number on the Aktif | Terhapus switch. */
export function countDeleted() {
  const n = (table: typeof transaksi | typeof customers | typeof salesmen | typeof users) =>
    db.select({ n: count() }).from(table).where(isNotNull(table.deletedAt)).get()?.n ?? 0;
  return {
    transaksi: n(transaksi),
    customer: n(customers),
    salesman: n(salesmen),
    user: n(users),
  };
}

export function listDeletedTransaksi(limit = 2000) {
  return db
    .select()
    .from(transaksi)
    .where(isNotNull(transaksi.deletedAt))
    .orderBy(desc(transaksi.deletedAt), desc(transaksi.id))
    .limit(limit)
    .all()
    .map((t) => ({
      ...t,
      customerNama: customerName(t.customerId),
      salesmanNama: salesmanName(t.salesmanId),
    }));
}

export function listDeletedCustomers() {
  return db
    .select()
    .from(customers)
    .where(isNotNull(customers.deletedAt))
    .orderBy(desc(customers.deletedAt), desc(customers.id))
    .all()
    .map((c) => ({ ...c, salesmanNama: salesmanName(c.salesmanId) }));
}

export function listDeletedSalesmen() {
  return attachWhatsapp(
    db
      .select()
      .from(salesmen)
      .where(isNotNull(salesmen.deletedAt))
      .orderBy(desc(salesmen.deletedAt), desc(salesmen.id))
      .all(),
  ).map((s) => ({ ...s, supervisorNama: (salesmanName(s.supervisorId) ?? "—") }));
}

export function listDeletedUsers() {
  const rows = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(isNotNull(users.deletedAt))
    .orderBy(desc(users.deletedAt), desc(users.id))
    .all();
  const roleRows = rolesForUsers(rows.map((u) => u.id));
  return rows.map((u) => ({ ...u, roleNames: (roleRows.get(u.id) ?? []).map((r) => r.name) }));
}

// ───────────────────────────────── restoring ─────────────────────────────────

export function restoreTransaksi(id: number, actingUserId?: number | null) {
  const row = db
    .select()
    .from(transaksi)
    .where(and(eq(transaksi.id, id), isNotNull(transaksi.deletedAt)))
    .get();
  if (!row) throw new Error("Transaksi tidak ada di daftar terhapus");
  try {
    assertLiveParents(row.customerId, row.salesmanId);
  } catch {
    throw new Error(
      `Transaksi #${id}: customer ${customerName(row.customerId)} atau salesman ` +
        `${salesmanName(row.salesmanId)} masih terhapus — pulihkan dulu`,
    );
  }
  db.update(transaksi)
    .set({
      deletedAt: null,
      deletedById: null,
      deletedWithCustomerId: null,
      updatedById: actingUserId ?? null,
    })
    .where(eq(transaksi.id, id))
    .run();
  syncCustomerLastOrderDate(row.customerId);
  logActivity({
    entityType: "transaksi",
    entityId: id,
    entityLabel: `${customerName(row.customerId)} · ${row.tanggalOrder}`,
    action: "restore",
    actorId: actingUserId,
    changes: snapshotChanges(transaksiFields(row), "create"),
  });
}

/**
 * Brings the customer back together with the transaksi that were deleted *with*
 * it (`deleted_with_customer_id`); transaksi deleted on their own earlier stay
 * deleted.
 */
export function restoreCustomer(id: number, actingUserId?: number | null) {
  const row = db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNotNull(customers.deletedAt)))
    .get();
  if (!row || !row.deletedAt) throw new Error("Customer tidak ada di daftar terhapus");
  if (!findLiveSalesman(row.salesmanId)) {
    throw new Error(
      `Customer ${row.nama}: salesman ${salesmanName(row.salesmanId)} masih terhapus — pulihkan dulu`,
    );
  }
  assertCustomerNameFree(row.nama, row.salesmanId, row.id);

  const cascade = db
    .select()
    .from(transaksi)
    .where(and(eq(transaksi.customerId, id), eq(transaksi.deletedWithCustomerId, id)))
    .all();
  const orphaned = [...new Set(cascade.map((t) => t.salesmanId))].filter(
    (sid) => !findLiveSalesman(sid),
  );
  if (orphaned.length > 0) {
    throw new Error(
      `Customer ${row.nama}: transaksinya atas nama salesman terhapus ` +
        `(${orphaned.map((sid) => salesmanName(sid)).join(", ")}) — pulihkan salesman itu dulu`,
    );
  }

  db.transaction((tx) => {
    tx.update(customers).set({ deletedAt: null }).where(eq(customers.id, id)).run();
    tx.update(transaksi)
      .set({ deletedAt: null, deletedById: null, deletedWithCustomerId: null })
      .where(and(eq(transaksi.customerId, id), eq(transaksi.deletedWithCustomerId, id)))
      .run();
  });
  syncCustomerLastOrderDate(id);
  logActivity({
    entityType: "customer",
    entityId: id,
    entityLabel: row.nama,
    action: "restore",
    actorId: actingUserId,
    changes: {
      ...snapshotChanges(customerFields(row), "create"),
      ...(cascade.length > 0 ? { transaksi_dipulihkan: { from: null, to: cascade.length } } : {}),
    },
  });
}

export function restoreSalesman(id: number, actingUserId?: number | null) {
  const row = db
    .select()
    .from(salesmen)
    .where(and(eq(salesmen.id, id), isNotNull(salesmen.deletedAt)))
    .get();
  if (!row) throw new Error("Salesman tidak ada di daftar terhapus");
  if (row.supervisorId != null && !findLiveSalesman(row.supervisorId)) {
    throw new Error(
      `Salesman ${row.nama}: atasannya (${salesmanName(row.supervisorId)}) masih terhapus — pulihkan dulu`,
    );
  }
  db.update(salesmen).set({ deletedAt: null }).where(eq(salesmen.id, id)).run();
  logActivity({
    entityType: "salesman",
    entityId: id,
    entityLabel: row.nama,
    action: "restore",
    actorId: actingUserId,
    changes: snapshotChanges(salesmanFields(row), "create"),
  });
}

export function restoreUser(id: number, actingUserId?: number | null) {
  const row = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      salesmanId: users.salesmanId,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.id, id), isNotNull(users.deletedAt)))
    .get();
  if (!row) throw new Error("User tidak ada di daftar terhapus");
  assertUsernameFree(row.username, row.id);
  db.update(users).set({ deletedAt: null }).where(eq(users.id, id)).run();
  logActivity({
    entityType: "user",
    entityId: id,
    entityLabel: row.username,
    action: "restore",
    actorId: actingUserId,
    changes: snapshotChanges(
      userFields({ ...row, roleNames: roleNamesOf(id) }),
      "create",
    ),
  });
}

/**
 * All-or-nothing: one failure rolls the whole batch back (activity rows
 * included), so the admin never has to work out which half applied. Salesmen
 * are restored supervisors-first so a subordinate and its supervisor can come
 * back in the same batch.
 */
function restoreAll(ids: number[], restoreOne: (id: number) => void) {
  db.transaction(() => {
    for (const id of ids) restoreOne(id);
  });
}

export const restoreTransaksiMany = (ids: number[], by?: number | null) =>
  restoreAll(ids, (id) => restoreTransaksi(id, by));
export const restoreCustomersMany = (ids: number[], by?: number | null) =>
  restoreAll(ids, (id) => restoreCustomer(id, by));
export const restoreUsersMany = (ids: number[], by?: number | null) =>
  restoreAll(ids, (id) => restoreUser(id, by));

export function restoreSalesmenMany(ids: number[], by?: number | null) {
  const batch = new Set(ids);
  const supervisorOf = new Map(
    ids.map((id) => [
      id,
      db.select({ s: salesmen.supervisorId }).from(salesmen).where(eq(salesmen.id, id)).get()?.s ?? null,
    ]),
  );
  // Depth within the batch: how many of its supervisors are also being restored.
  const depth = (id: number, seen = new Set<number>()): number => {
    if (seen.has(id)) return 0; // a corrupt cycle must not loop forever
    seen.add(id);
    const parent = supervisorOf.get(id);
    return parent != null && batch.has(parent) ? 1 + depth(parent, seen) : 0;
  };
  restoreAll(
    [...ids].sort((a, b) => depth(a) - depth(b)),
    (id) => restoreSalesman(id, by),
  );
}
