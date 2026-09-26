import { and, eq, sql } from "drizzle-orm";

import { hashPassword } from "~/lib/auth.server";
import { db } from "~/db/client.server";
import { alive, customers, salesmen, transaksi, users } from "~/db/schema";
import { diffChanges, logActivity, snapshotChanges } from "~/lib/activity.server";
import { setWhatsappNumber, whatsappNumber } from "~/lib/contacts.server";
import { moveAssignment, openAssignment, recordStatusChange } from "~/lib/customer-history.server";
import { salesmanName } from "~/lib/names.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import {
  assertAdministrationRemains,
  roleNamesOf,
  rolesNeedingSalesman,
  roleIdsByCode,
  setUserRoles,
} from "~/lib/roles.server";
import { isOverdue, nowIso } from "~/lib/dates";

export function clampCycleDays(value: number) {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

// Soft delete (ADR-0005): a deleted row is invisible to everything below. These
// finders are the one place that says so; name lookups for the activity trail
// (`salesmanName`) deliberately still see deleted rows.
export const findLiveCustomer = (id: number) =>
  db.select().from(customers).where(and(eq(customers.id, id), alive(customers))).get();
export const findLiveSalesman = (id: number) =>
  db.select().from(salesmen).where(and(eq(salesmen.id, id), alive(salesmen))).get();
export const listLiveSalesmen = () => db.select().from(salesmen).where(alive(salesmen)).all();
export const listLiveCustomers = () => db.select().from(customers).where(alive(customers)).all();
export const liveCustomersOf = (salesmanId: number) =>
  db.select().from(customers).where(and(eq(customers.salesmanId, salesmanId), alive(customers))).all();

/** Names differing only by case are the same customer (per salesman, live rows). */
export function assertCustomerNameFree(nama: string, salesmanId: number, exceptId?: number) {
  const clash = db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        alive(customers),
        eq(customers.salesmanId, salesmanId),
        sql`lower(${customers.nama}) = lower(${nama})`,
      ),
    )
    .all()
    .find((c) => c.id !== exceptId);
  if (clash) {
    throw new Error(`Customer "${nama}" sudah ada untuk salesman ${salesmanName(salesmanId)}`);
  }
}

// ───────────────────────── salesman hierarchy (ADR-0004) ─────────────────────────

function childrenMap() {
  const all = db
    .select({ id: salesmen.id, supervisorId: salesmen.supervisorId })
    .from(salesmen)
    .where(alive(salesmen))
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
  const target = findLiveSalesman(supervisorId);
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
  const customer = findLiveCustomer(opts.customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.statusCustomer !== "inactive") {
    throw new Error("Customer is not inactive");
  }
  db.transaction((tx) => {
    tx.update(customers)
      .set({ statusCustomer: "aktif" })
      .where(eq(customers.id, customer.id))
      .run();
    recordStatusChange(tx, {
      customerId: customer.id,
      from: "inactive",
      to: "aktif",
      reason: "manual_reactivation",
      changedById: opts.actingUserId,
    });
  });
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
  const customer = findLiveCustomer(opts.customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.salesmanId === opts.toSalesmanId) {
    throw new Error("Customer already assigned to that salesman");
  }
  if (!findLiveSalesman(opts.toSalesmanId)) throw new Error("Target salesman not found");
  assertCustomerNameFree(customer.nama, opts.toSalesmanId, customer.id);

  db.transaction((tx) => {
    moveAssignment(tx, {
      customerId: customer.id,
      toSalesmanId: opts.toSalesmanId,
      assignedById: opts.actingUserId,
    });
    tx.update(customers)
      .set({ salesmanId: opts.toSalesmanId })
      .where(eq(customers.id, customer.id))
      .run();
  });
}

export function customerFields(c: typeof customers.$inferSelect) {
  return {
    nama: c.nama,
    salesman: salesmanName(c.salesmanId),
    tipe_customer: c.tipeCustomer,
    status_customer: c.statusCustomer,
    order_cycle_days: c.orderCycleDays,
  };
}

/**
 * The only way a customer row is created: the row and its first assignment go
 * in together, so `customers.salesman_id` always has a matching open assignment.
 */
export function insertCustomer(
  values: typeof customers.$inferInsert,
  assignedById?: number | null,
) {
  return db.transaction((tx) => {
    const row = tx.insert(customers).values(values).returning().get();
    openAssignment(tx, { customerId: row.id, salesmanId: row.salesmanId, assignedById });
    return row;
  });
}

export function createCustomer(opts: {
  nama: string;
  salesmanId: number;
  tipeCustomer: "lama" | "baru";
  orderCycleDays: number;
  actingUserId?: number | null;
}) {
  if (!findLiveSalesman(opts.salesmanId)) throw new Error("Salesman tidak ditemukan");
  assertCustomerNameFree(opts.nama, opts.salesmanId);
  const row = insertCustomer(
    {
      nama: opts.nama,
      salesmanId: opts.salesmanId,
      tipeCustomer: opts.tipeCustomer,
      orderCycleDays: clampCycleDays(opts.orderCycleDays),
      statusCustomer: "aktif",
    },
    opts.actingUserId,
  );
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
  const customer = findLiveCustomer(opts.id);
  if (!customer) throw new Error("Customer not found");
  const nama = opts.nama || customer.nama;
  assertCustomerNameFree(nama, opts.salesmanId, customer.id);
  const before = customerFields(customer);

  db.transaction((tx) => {
    if (opts.salesmanId !== customer.salesmanId) {
      reassignCustomer({
        customerId: opts.id,
        toSalesmanId: opts.salesmanId,
        actingUserId: opts.actingUserId,
      });
    }
    tx.update(customers)
      .set({
        nama,
        orderCycleDays: clampCycleDays(opts.orderCycleDays),
        tipeCustomer: opts.tipeCustomer,
        statusCustomer: opts.statusCustomer,
      })
      .where(eq(customers.id, opts.id))
      .run();
    if (opts.statusCustomer !== customer.statusCustomer) {
      recordStatusChange(tx, {
        customerId: opts.id,
        from: customer.statusCustomer,
        to: opts.statusCustomer,
        reason: opts.statusCustomer === "inactive" ? "manual_inactive" : "manual_reactivation",
        changedById: opts.actingUserId,
      });
    }
  });

  const after = findLiveCustomer(opts.id)!;
  logActivity({
    entityType: "customer",
    entityId: opts.id,
    entityLabel: after.nama,
    action: "update",
    actorId: opts.actingUserId,
    changes: diffChanges(before, customerFields(after)),
  });
}

/**
 * Soft delete (ADR-0005). The customer's live transaksi go with it, marked
 * `deleted_with_customer_id` so a restore brings back exactly those and not
 * ones that were deleted on their own earlier. History rows (assignments,
 * status changes, reasons) are logs and stay untouched.
 */
export function deleteCustomerRecord(customerId: number, actingUserId?: number | null) {
  const existing = findLiveCustomer(customerId);
  if (!existing) return;
  const deletedAt = nowIso();
  const txCount = db.transaction((tx) => {
    const cascaded = tx
      .update(transaksi)
      .set({ deletedAt, deletedById: actingUserId ?? null, deletedWithCustomerId: customerId })
      .where(and(eq(transaksi.customerId, customerId), alive(transaksi)))
      .run().changes;
    tx.update(customers).set({ deletedAt }).where(eq(customers.id, customerId)).run();
    return cascaded;
  });

  logActivity({
    entityType: "customer",
    entityId: customerId,
    entityLabel: existing.nama,
    action: "delete",
    actorId: actingUserId,
    changes: {
      ...snapshotChanges(customerFields(existing), "delete"),
      ...(txCount > 0 ? { transaksi_terhapus: { from: txCount, to: null } } : {}),
    },
  });
}

export function deleteCustomersMany(ids: number[], actingUserId?: number | null) {
  for (const id of ids) {
    deleteCustomerRecord(id, actingUserId);
  }
}

// ───────────────────────────────── salesmen ─────────────────────────────────

/** `nomorWa` lives in `salesman_contacts`; pass it in (see `attachWhatsapp`) or it is looked up. */
export function salesmanFields(s: typeof salesmen.$inferSelect & { nomorWa?: string }) {
  return {
    nama: s.nama,
    nomor_wa: s.nomorWa ?? whatsappNumber(s.id),
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
      supervisorId: opts.supervisorId ?? null,
      status: opts.status ?? "aktif",
    })
    .returning()
    .get();
  setWhatsappNumber(row.id, opts.nomorWa ?? "");
  logActivity({
    entityType: "salesman",
    entityId: row.id,
    entityLabel: row.nama,
    action: "create",
    actorId: opts.actingUserId,
    changes: snapshotChanges(salesmanFields(row), "create"),
  });
  return { ...row, nomorWa: whatsappNumber(row.id) };
}

export function updateSalesman(opts: {
  id: number;
  nama: string;
  nomorWa: string;
  supervisorId: number | null;
  status: "aktif" | "inactive";
  actingUserId?: number | null;
}) {
  const existing = findLiveSalesman(opts.id);
  if (!existing) throw new Error("Salesman not found");
  assertValidSupervisor(opts.id, opts.supervisorId);
  const before = salesmanFields(existing);

  db.transaction(() => {
    db.update(salesmen)
      .set({
        nama: opts.nama.trim(),
        supervisorId: opts.supervisorId,
        status: opts.status,
      })
      .where(eq(salesmen.id, opts.id))
      .run();
    setWhatsappNumber(opts.id, opts.nomorWa);
  });

  const after = findLiveSalesman(opts.id)!;
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
  const linkedCustomers = liveCustomersOf(id).length;
  if (linkedCustomers > 0) {
    return `masih punya ${linkedCustomers} customer — pindahkan/hapus dulu`;
  }
  const txCount = db
    .select({ id: transaksi.id })
    .from(transaksi)
    .where(and(eq(transaksi.salesmanId, id), alive(transaksi)))
    .all().length;
  if (txCount > 0) return `masih punya ${txCount} transaksi — hapus transaksi dulu`;
  const remainingReports = directReportIds(id).filter((r) => !alsoDeleting.has(r));
  if (remainingReports.length > 0) {
    return `masih punya ${remainingReports.length} bawahan — pindahkan bawahannya dulu`;
  }
  return null;
}

/**
 * Soft delete (ADR-0005). Linked user accounts keep their profile so a restore
 * brings them back, but they cannot sign in while the salesman is deleted
 * (`getAuthUser`).
 */
export function deleteSalesman(id: number, actingUserId?: number | null) {
  const existing = findLiveSalesman(id);
  if (!existing) return;
  const blocker = salesmanDeleteBlocker(id);
  if (blocker) throw new Error(`Salesman ${existing.nama} ${blocker}`);
  db.update(salesmen).set({ deletedAt: nowIso() }).where(eq(salesmen.id, id)).run();
  logActivity({
    entityType: "salesman",
    entityId: id,
    entityLabel: existing.nama,
    action: "delete",
    actorId: actingUserId,
    changes: snapshotChanges(salesmanFields(existing), "delete"),
  });
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
    const sm = findLiveSalesman(id);
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

// DEBT-018: this rule used to be a CHECK on `profiles`; it is now enforced here (and failed closed by
// `requireSalesmanId`), not by the database.
function assertSalesmanLinked(
  roleIds: number[],
  salesmanId: number | null | undefined,
): number | null {
  const needing = rolesNeedingSalesman(roleIds);
  if (needing.length === 0) return null; // no role reaches salesman data: the link is dropped
  if (!salesmanId) throw new Error(`Pilih salesman untuk role ${needing.map((r) => r.name).join(", ")}`);
  if (!findLiveSalesman(salesmanId)) throw new Error("Salesman tidak ditemukan");
  return salesmanId;
}

function assertRolesChosen(roleIds: number[]) {
  if (roleIds.length === 0) throw new Error("Pilih minimal satu role");
}

/** Usernames are unique among live accounts only; a deleted one frees its name. */
export function assertUsernameFree(username: string, exceptId?: number) {
  const clash = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), alive(users)))
    .all()
    .find((u) => u.id !== exceptId);
  if (clash) throw new Error(`Username "${username}" sudah dipakai`);
}

export function userFields(u: {
  username: string;
  displayName: string;
  roleNames: string[];
  salesmanId: number | null;
  isActive: boolean;
}) {
  return {
    username: u.username,
    display_name: u.displayName,
    roles: [...u.roleNames].sort().join(", "),
    salesman: salesmanName(u.salesmanId),
    is_active: u.isActive ? "Aktif" : "Nonaktif",
  };
}

/** A live user with their roles, or undefined. */
function loadUser(id: number) {
  const row = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      salesmanId: users.salesmanId,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(and(eq(users.id, id), alive(users)))
    .get();
  if (!row) return undefined;
  return { ...row, roleNames: roleNamesOf(id) };
}

/** The demo password the seed and the docs used; refused for any real account. */
const PUBLIC_DEMO_PASSWORD = "sigula123";
export const MIN_PASSWORD_LENGTH = 8;

/** A password an admin sets for someone: long enough, and not the published demo one. Throws a readable error. */
export function assertPasswordAcceptable(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  if (password === PUBLIC_DEMO_PASSWORD) throw new Error("Password itu terlalu umum — pilih yang lain");
}

export async function createUserAccount(opts: {
  username: string;
  displayName: string;
  password: string;
  /** Role codes, e.g. `["admin"]`, `["salesman", "supervisor"]`. */
  roles: string[];
  salesmanId?: number | null;
  isActive?: boolean;
  actingUserId?: number | null;
}) {
  const roleIds = roleIdsByCode(opts.roles);
  assertRolesChosen(roleIds);
  const salesmanId = assertSalesmanLinked(roleIds, opts.salesmanId);
  assertUsernameFree(opts.username.trim());
  assertPasswordAcceptable(opts.password);
  const passwordHash = await hashPassword(opts.password);
  const user = db.transaction((tx) => {
    const row = tx
      .insert(users)
      .values({
        username: opts.username.trim(),
        displayName: opts.displayName.trim(),
        passwordHash,
        salesmanId,
        isActive: opts.isActive ?? true,
      })
      .returning()
      .get();
    setUserRoles(tx, row.id, roleIds, opts.actingUserId ?? null);
    return row;
  });
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
        roleNames: roleNamesOf(user.id),
        salesmanId,
        isActive: user.isActive,
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
  roles: string[];
  salesmanId?: number | null;
  isActive: boolean;
  actingUserId?: number | null;
}) {
  const existing = loadUser(opts.id);
  if (!existing) throw new Error("User not found");
  const roleIds = roleIdsByCode(opts.roles);
  assertRolesChosen(roleIds);
  const salesmanId = assertSalesmanLinked(roleIds, opts.salesmanId);
  assertAdministrationRemains({ userId: opts.id, after: { roleIds, isActive: opts.isActive } });

  const patch: { displayName: string; isActive: boolean; salesmanId: number | null; passwordHash?: string } = {
    displayName: opts.displayName.trim(),
    isActive: opts.isActive,
    salesmanId,
  };
  const passwordChanged = !!opts.password && opts.password.length > 0;
  if (passwordChanged) {
    assertPasswordAcceptable(opts.password!);
    patch.passwordHash = await hashPassword(opts.password!);
  }
  db.transaction((tx) => {
    tx.update(users).set(patch).where(eq(users.id, opts.id)).run();
    setUserRoles(tx, opts.id, roleIds, opts.actingUserId ?? null);
  });

  const changes = diffChanges(
    userFields(existing),
    userFields({
      username: existing.username,
      displayName: patch.displayName,
      roleNames: roleNamesOf(opts.id),
      salesmanId,
      isActive: opts.isActive,
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

/** Soft delete (ADR-0005): cannot sign in, keeps its roles, frees the username. */
export function deleteUserAccount(id: number, actingUserId?: number | null) {
  const existing = loadUser(id);
  if (!existing) return;
  assertAdministrationRemains({ userId: id, after: null });
  db.update(users).set({ deletedAt: nowIso() }).where(eq(users.id, id)).run();
  logActivity({
    entityType: "user",
    entityId: id,
    entityLabel: existing.username,
    action: "delete",
    actorId: actingUserId,
    changes: snapshotChanges(userFields(existing), "delete"),
  });
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
  const pending = pendingCustomerIds();
  return list.map((sm) => {
    const custs = liveCustomersOf(sm.id);
    return {
      ...sm,
      aktif: custs.filter((c) => c.statusCustomer === "aktif").length,
      inactive: custs.filter((c) => c.statusCustomer === "inactive").length,
      followUp: custs.filter(
        (c) =>
          c.statusCustomer === "aktif" &&
          isOverdue(c.lastOrderDate, c.orderCycleDays),
      ).length,
      pending: custs.filter((c) => pending.has(c.id)).length,
    };
  });
}

/**
 * With `supervisorId`: that supervisor's whole team — every subordinate at any
 * depth, excluding themself (ADR-0004: dashboards/reports span the subtree).
 */
export function salesmenWithStats(supervisorId?: number) {
  const all = listLiveSalesmen();
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
  const all = listLiveSalesmen();
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
        nomorWa: whatsappNumber(sup.id),
        salesmanCount: team.length,
        aktif: team.reduce((n, s) => n + s.aktif, 0),
        followUp: team.reduce((n, s) => n + s.followUp, 0),
        pending: team.reduce((n, s) => n + s.pending, 0),
      };
    });
}
