import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customerStatusHistory, transaksi } from "~/db/schema";
import {
  computeEligibleCustomers,
  createTransaksi,
  deleteTransaksiMany,
  listTransaksi,
  notYetNotifiedEligible,
  recordOrder,
} from "~/lib/orders.server";

import {
  TODAY,
  addCustomer,
  isPending,
  getCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

describe("computeEligibleCustomers (BR-2)", () => {
  beforeEach(() => resetDb());

  it("includes active overdue and never-ordered; excludes inactive and on-cycle", async () => {
    const { salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Overdue",
      lastOrderDate: "2026-07-01",
      orderCycleDays: 30,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Never",
      lastOrderDate: null,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "OnCycle",
      lastOrderDate: "2026-09-01",
      orderCycleDays: 30,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "InactiveOverdue",
      lastOrderDate: "2026-01-01",
      statusCustomer: "inactive",
    });

    const eligible = computeEligibleCustomers(TODAY).map((c) => c.nama).sort();
    expect(eligible).toEqual(["Never", "Overdue"]);
  });

  it("still includes already-notified overdue customers (dashboard visibility)", async () => {
    const { salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Pending",
      lastOrderDate: "2026-07-01",
      pending: true,
    });
    expect(computeEligibleCustomers(TODAY)).toHaveLength(1);
    expect(notYetNotifiedEligible(TODAY)).toHaveLength(0);
  });
});

describe("recordOrder (FR-9/FR-10, BR-5)", () => {
  beforeEach(() => resetDb());

  it("sets last_order_date, ends the pending reminder, appends OrderHistory", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "A",
      lastOrderDate: "2026-01-01",
      pending: true,
    });
    const result = recordOrder({
      customerId: c.id,
      actingUserId: admin.id,
      tanggalOrder: TODAY,
      sumber: "manual",
    });
    expect(result.reactivated).toBe(false);

    const updated = getCustomer(c.id);
    expect(updated.lastOrderDate).toBe(TODAY);
    expect(isPending(c.id)).toBe(false);
    expect(updated.statusCustomer).toBe("aktif");

    const history = db
      .select()
      .from(transaksi)
      .where(eq(transaksi.customerId, c.id))
      .all();
    expect(history).toHaveLength(1);
    expect(history[0].sumber).toBe("manual");
    expect(history[0].tanggalOrder).toBe(TODAY);
    expect(history[0].salesmanId).toBe(salesman.id);
  });

  it("auto-reactivates Inactive customers and records the transition", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Bangkrut",
      statusCustomer: "inactive",
      lastOrderDate: "2026-01-01",
    });

    const result = recordOrder({
      customerId: c.id,
      actingUserId: admin.id,
      tanggalOrder: TODAY,
    });
    expect(result.reactivated).toBe(true);
    expect(getCustomer(c.id).statusCustomer).toBe("aktif");

    const logs = db
      .select()
      .from(customerStatusHistory)
      .where(eq(customerStatusHistory.customerId, c.id))
      .all();
    expect(logs).toHaveLength(1);
    expect([logs[0].fromStatus, logs[0].toStatus]).toEqual(["inactive", "aktif"]);
    expect(logs[0].reason).toBe("auto_reactivation");
    expect(logs[0].changedById).toBe(admin.id);
  });
});

describe("deleteTransaksiMany", () => {
  beforeEach(() => resetDb());

  it("deletes every listed id and leaves the rest untouched", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko A" });
    const t1 = createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-01",
      actingUserId: admin.id,
    });
    const t2 = createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-15",
      actingUserId: admin.id,
    });
    const t3 = createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-09-01",
      actingUserId: admin.id,
    });
    const all = listTransaksi();
    expect(all).toHaveLength(3);

    const [row1, row3] = all.filter((r) =>
      [t1.tanggalOrder, t3.tanggalOrder].includes(r.tanggalOrder),
    );

    deleteTransaksiMany([row1.id, row3.id]);

    const remaining = listTransaksi();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tanggalOrder).toBe(t2.tanggalOrder);
  });

  it("recomputes the customer's last order date from what remains", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko B" });
    createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-01",
      actingUserId: admin.id,
    });
    const newest = createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-09-10",
      actingUserId: admin.id,
    });
    expect(getCustomer(c.id).lastOrderDate).toBe("2026-09-10");

    const newestRow = listTransaksi().find(
      (r) => r.tanggalOrder === newest.tanggalOrder,
    )!;
    deleteTransaksiMany([newestRow.id]);

    expect(getCustomer(c.id).lastOrderDate).toBe("2026-08-01");
  });

  it("is a no-op for an empty list", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko C" });
    createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-01",
      actingUserId: admin.id,
    });

    expect(() => deleteTransaksiMany([])).not.toThrow();
    expect(listTransaksi()).toHaveLength(1);
  });
});
