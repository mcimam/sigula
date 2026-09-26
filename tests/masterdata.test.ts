import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, mutationLogs, salesmen, statusLogs, users } from "~/db/schema";
import {
  clampCycleDays,
  deleteCustomersMany,
  deleteSalesmenMany,
  deleteUsersMany,
  reactivateCustomer,
  reassignCustomer,
  salesmenWithStats,
} from "~/lib/masterdata.server";

import {
  addCustomer,
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

  it("moves customer and appends MutationLog", async () => {
    const { salesman, salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });

    reassignCustomer({
      customerId: c.id,
      toSalesmanId: salesmanB.id,
      actingUserId: admin.id,
    });

    expect(getCustomer(c.id).salesmanId).toBe(salesmanB.id);
    const logs = db.select().from(mutationLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0].dariSalesmanId).toBe(salesman.id);
    expect(logs[0].keSalesmanId).toBe(salesmanB.id);
    expect(logs[0].olehId).toBe(admin.id);
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

  it("reactivates Inactive and logs manual_reactivation", async () => {
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
      .from(statusLogs)
      .where(eq(statusLogs.customerId, c.id))
      .all();
    expect(logs[0].tipe).toBe("manual_reactivation");
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
      notified: true,
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

  it("deletes every listed customer", async () => {
    const { salesman } = await seedOrg();
    const c1 = addCustomer({ salesmanId: salesman.id, nama: "Toko A" });
    const c2 = addCustomer({ salesmanId: salesman.id, nama: "Toko B" });
    const c3 = addCustomer({ salesmanId: salesman.id, nama: "Toko C" });

    deleteCustomersMany([c1.id, c3.id]);

    const remaining = db.select().from(customers).all();
    expect(remaining.map((c) => c.id)).toEqual([c2.id]);
  });
});

describe("deleteSalesmenMany", () => {
  beforeEach(() => resetDb());

  it("deletes salesmen with no linked customers or transaksi", async () => {
    const { salesman, salesmanB, supervisor } = await seedOrg();

    deleteSalesmenMany([salesmanB.id]);

    const remaining = db.select().from(salesmen).all();
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

    const ids = db.select().from(salesmen).all().map((s) => s.id);
    expect(ids).toContain(salesman.id);
    expect(ids).toContain(salesmanB.id);
  });
});

describe("deleteUsersMany", () => {
  beforeEach(() => resetDb());

  it("deletes the listed accounts", async () => {
    const { admin, salesmanUser } = await seedOrg();

    deleteUsersMany([salesmanUser.id], admin.id);

    const remaining = db.select().from(users).all();
    expect(remaining.map((u) => u.id)).toEqual([admin.id]);
  });

  it("refuses to delete the acting user's own account", async () => {
    const { admin, salesmanUser } = await seedOrg();

    expect(() => deleteUsersMany([admin.id, salesmanUser.id], admin.id)).toThrow(
      /akun sendiri/,
    );

    const remaining = db.select().from(users).all();
    expect(remaining).toHaveLength(2);
  });
});
