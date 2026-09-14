import { eq } from "drizzle-orm";

import { hashPassword } from "~/lib/auth.server";
import { db } from "~/db/client.server";
import {
  customers,
  mutationLogs,
  profiles,
  reasonLogs,
  salesmen,
  statusLogs,
  supervisors,
  transaksi,
  users,
  type Role,
} from "~/db/schema";
import { isOverdue } from "~/lib/dates";

export function clampCycleDays(value: number) {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function reactivateCustomer(opts: {
  customerId: number;
  actingUserId: number;
}) {
  const customer = db
    .select()
    .from(customers)
    .where(eq(customers.id, opts.customerId))
    .get();
  if (!customer) throw new Error("Customer not found");
  if (customer.statusCustomer !== "inactive") {
    throw new Error("Customer is not inactive");
  }
  db.update(customers)
    .set({ statusCustomer: "aktif" })
    .where(eq(customers.id, customer.id))
    .run();
  db.insert(statusLogs)
    .values({
      customerId: customer.id,
      tipe: "manual_reactivation",
      olehId: opts.actingUserId,
    })
    .run();
}

export function reassignCustomer(opts: {
  customerId: number;
  toSalesmanId: number;
  actingUserId: number;
}) {
  const customer = db
    .select()
    .from(customers)
    .where(eq(customers.id, opts.customerId))
    .get();
  if (!customer) throw new Error("Customer not found");
  if (customer.salesmanId === opts.toSalesmanId) {
    throw new Error("Customer already assigned to that salesman");
  }
  const target = db
    .select()
    .from(salesmen)
    .where(eq(salesmen.id, opts.toSalesmanId))
    .get();
  if (!target) throw new Error("Target salesman not found");

  db.insert(mutationLogs)
    .values({
      customerId: customer.id,
      dariSalesmanId: customer.salesmanId,
      keSalesmanId: opts.toSalesmanId,
      olehId: opts.actingUserId,
    })
    .run();
  db.update(customers)
    .set({ salesmanId: opts.toSalesmanId })
    .where(eq(customers.id, customer.id))
    .run();
}

export function deleteCustomerRecord(customerId: number) {
  db.delete(reasonLogs).where(eq(reasonLogs.customerId, customerId)).run();
  db.delete(transaksi).where(eq(transaksi.customerId, customerId)).run();
  db.delete(statusLogs).where(eq(statusLogs.customerId, customerId)).run();
  db.delete(mutationLogs).where(eq(mutationLogs.customerId, customerId)).run();
  db.delete(customers).where(eq(customers.id, customerId)).run();
}

export function createSalesman(opts: {
  nama: string;
  nomorWa?: string;
  supervisorId?: number | null;
  status?: "aktif" | "inactive";
}) {
  return db
    .insert(salesmen)
    .values({
      nama: opts.nama.trim(),
      nomorWa: opts.nomorWa ?? "",
      supervisorId: opts.supervisorId ?? null,
      status: opts.status ?? "aktif",
    })
    .returning()
    .get();
}

export function updateSalesman(opts: {
  id: number;
  nama: string;
  nomorWa: string;
  supervisorId: number | null;
  status: "aktif" | "inactive";
}) {
  db.update(salesmen)
    .set({
      nama: opts.nama.trim(),
      nomorWa: opts.nomorWa,
      supervisorId: opts.supervisorId,
      status: opts.status,
    })
    .where(eq(salesmen.id, opts.id))
    .run();
}

export function deleteSalesman(id: number) {
  const linked = db
    .select()
    .from(customers)
    .where(eq(customers.salesmanId, id))
    .all();
  if (linked.length > 0) {
    throw new Error(
      `Salesman masih punya ${linked.length} customer — pindahkan/hapus dulu`,
    );
  }
  const txCount = db
    .select()
    .from(transaksi)
    .where(eq(transaksi.salesmanId, id))
    .all().length;
  if (txCount > 0) {
    throw new Error(
      `Salesman masih punya ${txCount} transaksi — hapus transaksi dulu`,
    );
  }
  db.delete(profiles).where(eq(profiles.salesmanId, id)).run();
  db.delete(salesmen).where(eq(salesmen.id, id)).run();
}

export async function createUserAccount(opts: {
  username: string;
  displayName: string;
  password: string;
  role: Role;
  salesmanId?: number | null;
  supervisorId?: number | null;
}) {
  const passwordHash = await hashPassword(opts.password);
  const user = db
    .insert(users)
    .values({
      username: opts.username.trim(),
      displayName: opts.displayName.trim(),
      passwordHash,
    })
    .returning()
    .get();
  db.insert(profiles)
    .values({
      userId: user.id,
      role: opts.role,
      salesmanId: opts.role === "salesman" ? (opts.salesmanId ?? null) : null,
      supervisorId:
        opts.role === "supervisor" ? (opts.supervisorId ?? null) : null,
    })
    .run();
  return user;
}

export async function updateUserAccount(opts: {
  id: number;
  displayName: string;
  password?: string;
  role: Role;
  salesmanId?: number | null;
  supervisorId?: number | null;
}) {
  const patch: { displayName: string; passwordHash?: string } = {
    displayName: opts.displayName.trim(),
  };
  if (opts.password && opts.password.length > 0) {
    patch.passwordHash = await hashPassword(opts.password);
  }
  db.update(users).set(patch).where(eq(users.id, opts.id)).run();
  db.update(profiles)
    .set({
      role: opts.role,
      salesmanId: opts.role === "salesman" ? (opts.salesmanId ?? null) : null,
      supervisorId:
        opts.role === "supervisor" ? (opts.supervisorId ?? null) : null,
    })
    .where(eq(profiles.userId, opts.id))
    .run();
}

export function deleteUserAccount(id: number) {
  db.delete(profiles).where(eq(profiles.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();
}

export function salesmenWithStats(supervisorId?: number) {
  const list =
    supervisorId != null
      ? db
          .select()
          .from(salesmen)
          .where(eq(salesmen.supervisorId, supervisorId))
          .all()
      : db.select().from(salesmen).all();

  return list.map((sm) => {
    const custs = db
      .select()
      .from(customers)
      .where(eq(customers.salesmanId, sm.id))
      .all();
    return {
      ...sm,
      aktif: custs.filter((c) => c.statusCustomer === "aktif").length,
      inactive: custs.filter((c) => c.statusCustomer === "inactive").length,
      followUp: custs.filter(
        (c) =>
          c.statusCustomer === "aktif" &&
          isOverdue(c.lastOrderDate, c.orderCycleDays),
      ).length,
      pending: custs.filter((c) => c.notified).length,
    };
  });
}

export function supervisorsWithStats() {
  return db
    .select()
    .from(supervisors)
    .all()
    .map((sup) => {
      const team = salesmenWithStats(sup.id);
      return {
        ...sup,
        salesmanCount: team.length,
        aktif: team.reduce((n, s) => n + s.aktif, 0),
        followUp: team.reduce((n, s) => n + s.followUp, 0),
        pending: team.reduce((n, s) => n + s.pending, 0),
      };
    });
}
