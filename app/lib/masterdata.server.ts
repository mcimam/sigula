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
  transaksi,
  users,
  type Role,
} from "~/db/schema";
import { diffChanges, logActivity, snapshotChanges } from "~/lib/activity.server";
import { isOverdue } from "~/lib/dates";

export function clampCycleDays(value: number) {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

const salesmanName = (id: number | null | undefined) =>
  id == null
    ? null
    : (db.select({ n: salesmen.nama }).from(salesmen).where(eq(salesmen.id, id)).get()?.n ??
      `#${id}`);

// ───────────────────────── salesman hierarchy (ADR-0004) ─────────────────────────

function childrenMap() {
  const all = db
    .select({ id: salesmen.id, supervisorId: salesmen.supervisorId })
    .from(salesmen)
    .all();
  const map = new Map<number, number[]>();
  for (const s of all) {
    if (s.supervisorId == null) continue;
    const list = map.get(s.supervisorId) ?? [];
    list.push(s.id);
    map.set(s.supervisorId, list);
  }
  return map;
}

/** Everyone below `rootId`, any depth (BFS; a corrupt cycle can't loop forever). */
export function subordinateIds(rootId: number): number[] {
  const children = childrenMap();
  const out: number[] = [];
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

export function directReportIds(supervisorId: number): number[] {
  return childrenMap().get(supervisorId) ?? [];
}

/** Rejects a parent link that is self-referential or would form a cycle. */
export function assertValidSupervisor(
  salesmanId: number | null,
  supervisorId: number | null,
) {
  if (supervisorId == null) return;
  const target = db.select().from(salesmen).where(eq(salesmen.id, supervisorId)).get();
  if (!target) throw new Error("Supervisor tidak ditemukan");
  if (salesmanId == null) return;
  if (supervisorId === salesmanId) {
    throw new Error("Salesman tidak bisa menjadi supervisor dirinya sendiri");
  }
  if (subordinateIds(salesmanId).includes(supervisorId)) {
    throw new Error(
      `${target.nama} adalah bawahan salesman ini — menjadikannya supervisor akan membentuk siklus`,
    );
  }
}

// ───────────────────────────────── customers ─────────────────────────────────

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
  logActivity({
    entityType: "customer",
    entityId: customer.id,
    entityLabel: customer.nama,
    action: "update",
    actorId: opts.actingUserId,
    changes: { status_customer: { from: "inactive", to: "aktif" } },
  });
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

function customerFields(c: typeof customers.$inferSelect) {
  return {
    nama: c.nama,
    salesman: salesmanName(c.salesmanId),
    tipe_customer: c.tipeCustomer,
    status_customer: c.statusCustomer,
    order_cycle_days: c.orderCycleDays,
  };
}

export function createCustomer(opts: {
  nama: string;
  salesmanId: number;
  tipeCustomer: "lama" | "baru";
  orderCycleDays: number;
  actingUserId?: number | null;
}) {
  const row = db
    .insert(customers)
    .values({
      nama: opts.nama,
      salesmanId: opts.salesmanId,
      tipeCustomer: opts.tipeCustomer,
      orderCycleDays: clampCycleDays(opts.orderCycleDays),
      statusCustomer: "aktif",
    })
    .returning()
    .get();
  logActivity({
    entityType: "customer",
    entityId: row.id,
    entityLabel: row.nama,
    action: "create",
    actorId: opts.actingUserId,
    changes: snapshotChanges(customerFields(row), "create"),
  });
  return row;
}

export function updateCustomer(opts: {
  id: number;
  nama: string;
  salesmanId: number;
  tipeCustomer: "lama" | "baru";
  statusCustomer: "aktif" | "inactive";
  orderCycleDays: number;
  actingUserId: number;
}) {
  const customer = db.select().from(customers).where(eq(customers.id, opts.id)).get();
  if (!customer) throw new Error("Customer not found");
  const before = customerFields(customer);

  if (opts.salesmanId !== customer.salesmanId) {
    reassignCustomer({
      customerId: opts.id,
      toSalesmanId: opts.salesmanId,
      actingUserId: opts.actingUserId,
    });
  }
  db.update(customers)
    .set({
      nama: opts.nama || customer.nama,
      orderCycleDays: clampCycleDays(opts.orderCycleDays),
      tipeCustomer: opts.tipeCustomer,
      statusCustomer: opts.statusCustomer,
    })
    .where(eq(customers.id, opts.id))
    .run();

  const after = db.select().from(customers).where(eq(customers.id, opts.id)).get()!;
  logActivity({
    entityType: "customer",
    entityId: opts.id,
    entityLabel: after.nama,
    action: "update",
    actorId: opts.actingUserId,
    changes: diffChanges(before, customerFields(after)),
  });
}

export function deleteCustomerRecord(customerId: number, actingUserId?: number | null) {
  const existing = db.select().from(customers).where(eq(customers.id, customerId)).get();
  const fields = existing ? customerFields(existing) : {};
  const txCount = db
    .select({ id: transaksi.id })
    .from(transaksi)
    .where(eq(transaksi.customerId, customerId))
    .all().length;

  db.delete(reasonLogs).where(eq(reasonLogs.customerId, customerId)).run();
  db.delete(transaksi).where(eq(transaksi.customerId, customerId)).run();
  db.delete(statusLogs).where(eq(statusLogs.customerId, customerId)).run();
  db.delete(mutationLogs).where(eq(mutationLogs.customerId, customerId)).run();
  db.delete(customers).where(eq(customers.id, customerId)).run();

  if (existing) {
    logActivity({
      entityType: "customer",
      entityId: customerId,
      entityLabel: existing.nama,
      action: "delete",
      actorId: actingUserId,
      changes: {
        ...snapshotChanges(fields, "delete"),
        ...(txCount > 0 ? { transaksi_terhapus: { from: txCount, to: null } } : {}),
      },
    });
  }
}

export function deleteCustomersMany(ids: number[], actingUserId?: number | null) {
  for (const id of ids) {
    deleteCustomerRecord(id, actingUserId);
  }
}

// ───────────────────────────────── salesmen ─────────────────────────────────

function salesmanFields(s: typeof salesmen.$inferSelect) {
  return {
    nama: s.nama,
    nomor_wa: s.nomorWa,
    supervisor: salesmanName(s.supervisorId),
    status: s.status,
  };
}

export function createSalesman(opts: {
  nama: string;
  nomorWa?: string;
  supervisorId?: number | null;
  status?: "aktif" | "inactive";
  actingUserId?: number | null;
}) {
  assertValidSupervisor(null, opts.supervisorId ?? null);
  const row = db
    .insert(salesmen)
    .values({
      nama: opts.nama.trim(),
      nomorWa: opts.nomorWa ?? "",
      supervisorId: opts.supervisorId ?? null,
      status: opts.status ?? "aktif",
    })
    .returning()
    .get();
  logActivity({
    entityType: "salesman",
    entityId: row.id,
    entityLabel: row.nama,
    action: "create",
    actorId: opts.actingUserId,
    changes: snapshotChanges(salesmanFields(row), "create"),
  });
  return row;
}

export function updateSalesman(opts: {
  id: number;
  nama: string;
  nomorWa: string;
  supervisorId: number | null;
  status: "aktif" | "inactive";
  actingUserId?: number | null;
}) {
  const existing = db.select().from(salesmen).where(eq(salesmen.id, opts.id)).get();
  if (!existing) throw new Error("Salesman not found");
  assertValidSupervisor(opts.id, opts.supervisorId);
  const before = salesmanFields(existing);

  db.update(salesmen)
    .set({
      nama: opts.nama.trim(),
      nomorWa: opts.nomorWa,
      supervisorId: opts.supervisorId,
      status: opts.status,
    })
    .where(eq(salesmen.id, opts.id))
    .run();

  const after = db.select().from(salesmen).where(eq(salesmen.id, opts.id)).get()!;
  logActivity({
    entityType: "salesman",
    entityId: opts.id,
    entityLabel: after.nama,
    action: "update",
    actorId: opts.actingUserId,
    changes: diffChanges(before, salesmanFields(after)),
  });
}

/** Why `id` can't be deleted right now, or null. `alsoDeleting` = ids removed in the same batch. */
function salesmanDeleteBlocker(id: number, alsoDeleting: Set<number> = new Set()) {
  const linkedCustomers = db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.salesmanId, id))
    .all().length;
  if (linkedCustomers > 0) {
    return `masih punya ${linkedCustomers} customer — pindahkan/hapus dulu`;
  }
  const txCount = db
    .select({ id: transaksi.id })
    .from(transaksi)
    .where(eq(transaksi.salesmanId, id))
    .all().length;
  if (txCount > 0) return `masih punya ${txCount} transaksi — hapus transaksi dulu`;
  const remainingReports = directReportIds(id).filter((r) => !alsoDeleting.has(r));
  if (remainingReports.length > 0) {
    return `masih punya ${remainingReports.length} bawahan — pindahkan bawahannya dulu`;
  }
  return null;
}

export function deleteSalesman(id: number, actingUserId?: number | null) {
  const existing = db.select().from(salesmen).where(eq(salesmen.id, id)).get();
  const blocker = salesmanDeleteBlocker(id);
  if (blocker) throw new Error(`Salesman ${existing?.nama ?? `#${id}`} ${blocker}`);
  const fields = existing ? salesmanFields(existing) : {};
  db.delete(profiles).where(eq(profiles.salesmanId, id)).run();
  db.delete(salesmen).where(eq(salesmen.id, id)).run();
  if (existing) {
    logActivity({
      entityType: "salesman",
      entityId: id,
      entityLabel: existing.nama,
      action: "delete",
      actorId: actingUserId,
      changes: snapshotChanges(fields, "delete"),
    });
  }
}

/**
 * All-or-nothing: every id is checked before any delete runs, so a blocked
 * salesman never leaves the batch half-applied. Subordinates deleted in the
 * same batch don't block their supervisor; children are removed first.
 */
export function deleteSalesmenMany(ids: number[], actingUserId?: number | null) {
  const batch = new Set(ids);
  const blocked: string[] = [];
  for (const id of ids) {
    const sm = db.select().from(salesmen).where(eq(salesmen.id, id)).get();
    if (!sm) continue;
    const blocker = salesmanDeleteBlocker(id, batch);
    if (blocker) blocked.push(`${sm.nama} ${blocker}`);
  }
  if (blocked.length > 0) {
    throw new Error(`Tidak bisa hapus: ${blocked.join("; ")}`);
  }

  const pending = new Set(ids);
  while (pending.size > 0) {
    const ready = [...pending].filter((id) =>
      directReportIds(id).every((child) => !pending.has(child)),
    );
    if (ready.length === 0) throw new Error("Hierarki salesman tidak konsisten");
    for (const id of ready) {
      deleteSalesman(id, actingUserId);
      pending.delete(id);
    }
  }
}

// ─────────────────────────────────── users ───────────────────────────────────

const linksSalesman = (role: Role) => role === "salesman" || role === "supervisor";

function assertRoleLink(role: Role, salesmanId: number | null | undefined) {
  if (linksSalesman(role) && !salesmanId) {
    throw new Error(`Pilih salesman untuk role ${role}`);
  }
}

function userFields(u: {
  username: string;
  displayName: string;
  role: Role;
  salesmanId: number | null;
}) {
  return {
    username: u.username,
    display_name: u.displayName,
    role: u.role,
    salesman: salesmanName(u.salesmanId),
  };
}

function loadUser(id: number) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: profiles.role,
      salesmanId: profiles.salesmanId,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, id))
    .get();
}

export async function createUserAccount(opts: {
  username: string;
  displayName: string;
  password: string;
  role: Role;
  salesmanId?: number | null;
  actingUserId?: number | null;
}) {
  assertRoleLink(opts.role, opts.salesmanId);
  const passwordHash = await hashPassword(opts.password);
  const salesmanId = linksSalesman(opts.role) ? (opts.salesmanId ?? null) : null;
  const user = db
    .insert(users)
    .values({
      username: opts.username.trim(),
      displayName: opts.displayName.trim(),
      passwordHash,
    })
    .returning()
    .get();
  db.insert(profiles).values({ userId: user.id, role: opts.role, salesmanId }).run();
  logActivity({
    entityType: "user",
    entityId: user.id,
    entityLabel: user.username,
    action: "create",
    actorId: opts.actingUserId,
    changes: snapshotChanges(
      userFields({
        username: user.username,
        displayName: user.displayName,
        role: opts.role,
        salesmanId,
      }),
      "create",
    ),
  });
  return user;
}

export async function updateUserAccount(opts: {
  id: number;
  displayName: string;
  password?: string;
  role: Role;
  salesmanId?: number | null;
  actingUserId?: number | null;
}) {
  const existing = loadUser(opts.id);
  if (!existing) throw new Error("User not found");
  assertRoleLink(opts.role, opts.salesmanId);
  const salesmanId = linksSalesman(opts.role) ? (opts.salesmanId ?? null) : null;

  const patch: { displayName: string; passwordHash?: string } = {
    displayName: opts.displayName.trim(),
  };
  const passwordChanged = !!opts.password && opts.password.length > 0;
  if (passwordChanged) {
    patch.passwordHash = await hashPassword(opts.password!);
  }
  db.update(users).set(patch).where(eq(users.id, opts.id)).run();
  db.update(profiles)
    .set({ role: opts.role, salesmanId })
    .where(eq(profiles.userId, opts.id))
    .run();

  const changes = diffChanges(
    userFields(existing),
    userFields({
      username: existing.username,
      displayName: patch.displayName,
      role: opts.role,
      salesmanId,
    }),
  );
  // The value itself is never recorded — only that it changed.
  if (passwordChanged) changes.password = { from: null, to: "(diubah)" };
  logActivity({
    entityType: "user",
    entityId: opts.id,
    entityLabel: existing.username,
    action: "update",
    actorId: opts.actingUserId,
    changes,
  });
}

export function deleteUserAccount(id: number, actingUserId?: number | null) {
  const existing = loadUser(id);
  db.delete(profiles).where(eq(profiles.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();
  if (existing) {
    logActivity({
      entityType: "user",
      entityId: id,
      entityLabel: existing.username,
      action: "delete",
      actorId: actingUserId,
      changes: snapshotChanges(userFields(existing), "delete"),
    });
  }
}

export function deleteUsersMany(ids: number[], actingUserId: number) {
  if (ids.includes(actingUserId)) {
    throw new Error("Tidak bisa menghapus akun sendiri");
  }
  for (const id of ids) {
    deleteUserAccount(id, actingUserId);
  }
}

// ──────────────────────────────── team statistics ────────────────────────────────

function statsFor(list: (typeof salesmen.$inferSelect)[]) {
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

/**
 * With `supervisorId`: that supervisor's whole team — every subordinate at any
 * depth, excluding themself (ADR-0004: dashboards/reports span the subtree).
 */
export function salesmenWithStats(supervisorId?: number) {
  const all = db.select().from(salesmen).all();
  if (supervisorId == null) return statsFor(all);
  const team = new Set(subordinateIds(supervisorId));
  return statsFor(all.filter((s) => team.has(s.id)));
}

/**
 * Management overview: every salesman who has direct reports, with stats over
 * those direct reports — a partition (each salesman counted under exactly one
 * supervisor), so totals never double count.
 */
export function supervisorsWithStats() {
  const all = db.select().from(salesmen).all();
  const bySupervisor = new Map<number, (typeof salesmen.$inferSelect)[]>();
  for (const sm of all) {
    if (sm.supervisorId == null) continue;
    const list = bySupervisor.get(sm.supervisorId) ?? [];
    list.push(sm);
    bySupervisor.set(sm.supervisorId, list);
  }
  return all
    .filter((sm) => bySupervisor.has(sm.id))
    .map((sup) => {
      const team = statsFor(bySupervisor.get(sup.id)!);
      return {
        id: sup.id,
        nama: sup.nama,
        nomorWa: sup.nomorWa,
        salesmanCount: team.length,
        aktif: team.reduce((n, s) => n + s.aktif, 0),
        followUp: team.reduce((n, s) => n + s.followUp, 0),
        pending: team.reduce((n, s) => n + s.pending, 0),
      };
    });
}
