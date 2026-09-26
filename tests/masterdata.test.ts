import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, customerStatusHistory, customers, salesmen, users } from "~/db/schema";
import { listAssignmentMovesPage } from "~/lib/customer-history.server";
import { migrateDatabase } from "~/db/migrate.server";
import { sqlite } from "~/db/client.server";
import {
  clampCycleDays,
  deleteCustomersMany,
  deleteSalesmenMany,
  deleteUsersMany,
  reactivateCustomer,
  reassignCustomer,
  salesmenWithStats,
  updateCustomer,
} from "~/lib/masterdata.server";

import {
  addCustomer,
  assignmentHistory,
  getCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

describe("clampCycleDays (BR-6)", () => {
  it("clamps non-positive and non-finite values to 1", () => {
    expect(clampCycleDays(0)).toBe(1);
    expect(clampCycleDays(-5)).toBe(1);
    expect(clampCycleDays(Number.NaN)).toBe(1);
    expect(clampCycleDays(14.9)).toBe(14);
  });
});

describe("reassignCustomer (FR-12)", () => {
  beforeEach(() => resetDb());

  it("moves customer and closes/opens its assignment history", async () => {
    const { salesman, salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });

    reassignCustomer({
      customerId: c.id,
      toSalesmanId: salesmanB.id,
      actingUserId: admin.id,
    });

    expect(getCustomer(c.id).salesmanId).toBe(salesmanB.id);
    const history = assignmentHistory(c.id);
    expect(history).toHaveLength(2);
    expect(history[0].salesmanId).toBe(salesman.id);
    expect(history[0].validTo).toBe(history[1].validFrom);
    expect(history[1].salesmanId).toBe(salesmanB.id);
    expect(history[1].validTo).toBeNull();
    expect(history[1].assignedById).toBe(admin.id);
    const [move] = listAssignmentMovesPage(1, 10).rows;
    expect([move.fromSalesmanId, move.toSalesmanId]).toEqual([salesman.id, salesmanB.id]);
  });

  it("rejects reassignment to the current salesman", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    expect(() =>
      reassignCustomer({
        customerId: c.id,
        toSalesmanId: salesman.id,
        actingUserId: admin.id,
      }),
    ).toThrow(/already assigned/);
  });
});

describe("reactivateCustomer (FR-11)", () => {
  beforeEach(() => resetDb());

  it("reactivates Inactive and records the transition", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      statusCustomer: "inactive",
    });
    reactivateCustomer({ customerId: c.id, actingUserId: admin.id });
    expect(getCustomer(c.id).statusCustomer).toBe("aktif");
    const logs = db
      .select()
      .from(customerStatusHistory)
      .where(eq(customerStatusHistory.customerId, c.id))
      .all();
    expect(logs).toHaveLength(1);
    expect([logs[0].fromStatus, logs[0].toStatus]).toEqual(["inactive", "aktif"]);
    expect(logs[0].reason).toBe("manual_reactivation");
    expect(logs[0].changedById).toBe(admin.id);
  });

  it("rejects reactivation of an already-active customer", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    expect(() =>
      reactivateCustomer({ customerId: c.id, actingUserId: admin.id }),
    ).toThrow(/not inactive/);
  });
});

describe("salesmenWithStats", () => {
  beforeEach(() => resetDb());

  it("aggregates aktif/inactive/follow-up/pending for a supervisor team", async () => {
    const { salesman, supervisor } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Overdue",
      lastOrderDate: "2026-01-01",
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Pending",
      lastOrderDate: "2026-01-01",
      pending: true,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Dead",
      statusCustomer: "inactive",
    });

    const stats = salesmenWithStats(supervisor.id);
    const andi = stats.find((s) => s.id === salesman.id)!;
    expect(andi.aktif).toBe(2);
    expect(andi.inactive).toBe(1);
    expect(andi.followUp).toBe(2);
    expect(andi.pending).toBe(1);
  });
});

describe("deleteCustomersMany", () => {
  beforeEach(() => resetDb());

  it("soft-deletes every listed customer", async () => {
    const { salesman } = await seedOrg();
    const c1 = addCustomer({ salesmanId: salesman.id, nama: "Toko A" });
    const c2 = addCustomer({ salesmanId: salesman.id, nama: "Toko B" });
    const c3 = addCustomer({ salesmanId: salesman.id, nama: "Toko C" });

    deleteCustomersMany([c1.id, c3.id]);

    const live = db.select().from(customers).where(alive(customers)).all();
    expect(live.map((c) => c.id)).toEqual([c2.id]);
    // The rows are still there — that is what makes them restorable.
    expect(db.select().from(customers).all()).toHaveLength(3);
    // History is a log: it is never removed with the customer.
    expect(assignmentHistory(c1.id)).toHaveLength(1);
  });
});

describe("deleteSalesmenMany", () => {
  beforeEach(() => resetDb());

  it("deletes salesmen with no linked customers or transaksi", async () => {
    const { salesman, salesmanB, supervisor } = await seedOrg();

    deleteSalesmenMany([salesmanB.id]);

    const remaining = db.select().from(salesmen).where(alive(salesmen)).all();
    expect(remaining.map((s) => s.id).sort()).toEqual(
      [salesman.id, supervisor.id].sort(),
    );
  });

  it("is all-or-nothing: a blocked salesman aborts the whole batch", async () => {
    const { salesman, salesmanB } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko A" });

    expect(() => deleteSalesmenMany([salesmanB.id, salesman.id])).toThrow(
      /masih punya 1 customer/,
    );

    const ids = db.select().from(salesmen).where(alive(salesmen)).all().map((s) => s.id);
    expect(ids).toContain(salesman.id);
    expect(ids).toContain(salesmanB.id);
  });
});

describe("deleteUsersMany", () => {
  beforeEach(() => resetDb());

  it("deletes the listed accounts", async () => {
    const { admin, salesmanUser } = await seedOrg();

    deleteUsersMany([salesmanUser.id], admin.id);

    const remaining = db.select().from(users).where(alive(users)).all();
    expect(remaining.map((u) => u.id)).toEqual([admin.id]);
  });

  it("refuses to delete the acting user's own account", async () => {
    const { admin, salesmanUser } = await seedOrg();

    expect(() => deleteUsersMany([admin.id, salesmanUser.id], admin.id)).toThrow(
      /akun sendiri/,
    );

    const remaining = db.select().from(users).where(alive(users)).all();
    expect(remaining).toHaveLength(2);
  });
});

describe("updateCustomer status changes", () => {
  beforeEach(() => resetDb());

  it("records a manual inactive/reactivation made through the edit form, and only real changes", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const edit = (statusCustomer: "aktif" | "inactive") =>
      updateCustomer({
        id: c.id, nama: "Toko", salesmanId: salesman.id, tipeCustomer: "lama",
        statusCustomer, orderCycleDays: 30, actingUserId: admin.id,
      });

    edit("aktif"); // no change
    edit("inactive");
    edit("aktif");

    const rows = db
      .select()
      .from(customerStatusHistory)
      .where(eq(customerStatusHistory.customerId, c.id))
      .all();
    expect(rows.map((r) => `${r.fromStatus}>${r.toStatus}:${r.reason}`)).toEqual([
      "aktif>inactive:manual_inactive",
      "inactive>aktif:manual_reactivation",
    ]);
  });
});

describe("migrateDatabase() on an already-migrated database", () => {
  it("does not resurrect the retired legacy tables or the old unique index", () => {
    resetDb();
    migrateDatabase(sqlite); // what every later boot does
    const names = (sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name IN ('mutation_logs', 'status_logs', 'unique_customer_name_per_salesman')")
      .all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual([]);
  });
});
