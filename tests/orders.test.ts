import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, transaksi, statusLogs } from "~/db/schema";
import {
  computeEligibleCustomers,
  notYetNotifiedEligible,
  recordOrder,
} from "~/lib/orders.server";

import {
  TODAY,
  addCustomer,
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
      notified: true,
    });
    expect(computeEligibleCustomers(TODAY)).toHaveLength(1);
    expect(notYetNotifiedEligible(TODAY)).toHaveLength(0);
  });
});

describe("recordOrder (FR-9/FR-10, BR-5)", () => {
  beforeEach(() => resetDb());

  it("sets last_order_date, clears notified/handled_on, appends OrderHistory", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "A",
      lastOrderDate: "2026-01-01",
      notified: true,
    });
    db.update(customers)
      .set({ handledOn: "2026-08-01" })
      .where(eq(customers.id, c.id))
      .run();

    const result = recordOrder({
      customerId: c.id,
      actingUserId: admin.id,
      tanggalOrder: TODAY,
      sumber: "manual",
    });
    expect(result.reactivated).toBe(false);

    const updated = getCustomer(c.id);
    expect(updated.lastOrderDate).toBe(TODAY);
    expect(updated.notified).toBe(false);
    expect(updated.handledOn).toBeNull();
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

  it("auto-reactivates Inactive customers and writes StatusLog", async () => {
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
      .from(statusLogs)
      .where(eq(statusLogs.customerId, c.id))
      .all();
    expect(logs).toHaveLength(1);
    expect(logs[0].tipe).toBe("auto_reactivation");
    expect(logs[0].olehId).toBe(admin.id);
  });
});
