import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  customers,
  notificationBatches,
  notificationDeliveries,
  reasonLogs,
  statusLogs,
} from "~/db/schema";
import {
  deleteBatch,
  eligibleCustomerCount,
  previewBatch,
  retryBatch,
  submitReason,
  triggerBatch,
} from "~/lib/reminders.server";
import type { WahaClient } from "~/lib/waha.server";

import {
  TODAY,
  addCustomer,
  getCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

function fakeClient(opts?: {
  failFor?: string[];
  alwaysFail?: boolean;
}): WahaClient & { calls: { nomorWa: string; text: string }[] } {
  const calls: { nomorWa: string; text: string }[] = [];
  return {
    calls,
    async sendText(nomorWa, text) {
      calls.push({ nomorWa, text });
      if (opts?.alwaysFail) {
        return { ok: false, errorMessage: "down" };
      }
      if (opts?.failFor?.includes(nomorWa)) {
        return { ok: false, errorMessage: "fail" };
      }
      return { ok: true };
    },
  };
}

describe("triggerBatch / preview (FR-3, double-click)", () => {
  beforeEach(() => resetDb());

  it("returns null and creates nothing when nobody is eligible", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Fresh",
      lastOrderDate: "2026-09-10",
      orderCycleDays: 30,
    });
    const client = fakeClient();
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(batch).toBeNull();
    expect(client.calls).toHaveLength(0);
    expect(db.select().from(notificationBatches).all()).toHaveLength(0);
  });

  it("sends to salesman+supervisor, flips notified only on salesman success", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Toko A",
      lastOrderDate: "2026-07-01",
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Toko B",
      lastOrderDate: null,
    });

    const client = fakeClient();
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(batch).not.toBeNull();
    expect(client.calls.length).toBe(2);

    const deliveries = db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.batchId, batch!.id))
      .all();
    expect(deliveries.every((d) => d.status === "sent")).toBe(true);

    const notified = db
      .select()
      .from(customers)
      .all()
      .filter((c) => c.notified);
    expect(notified.map((c) => c.nama).sort()).toEqual(["Toko A", "Toko B"]);
  });

  it("second trigger is a no-op once customers are notified (FR-3 regression)", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    const client = fakeClient();
    const first = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(first).not.toBeNull();
    const callsAfterFirst = client.calls.length;

    const second = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(second).toBeNull();
    expect(client.calls.length).toBe(callsAfterFirst);
    expect(eligibleCustomerCount(TODAY)).toBe(0);
  });

  it("preview excludes already-notified customers", async () => {
    const { salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Pending",
      lastOrderDate: "2026-07-01",
      notified: true,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "FreshOverdue",
      lastOrderDate: "2026-07-01",
      notified: false,
    });
    const preview = previewBatch(TODAY);
    expect(preview.salesmen).toHaveLength(1);
    expect(preview.salesmen[0].customers.map((c) => c.nama)).toEqual([
      "FreshOverdue",
    ]);
  });

  it("skips recipients without WA and does not flip notified", async () => {
    const { admin, salesman } = await seedOrg({
      salesmanWa: "",
      supervisorWa: "",
    });
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    const client = fakeClient();
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(batch).not.toBeNull();
    expect(client.calls).toHaveLength(0);
    const deliveries = db.select().from(notificationDeliveries).all();
    expect(deliveries.every((d) => d.status === "skipped_no_phone")).toBe(true);
    expect(getCustomer(c.id).notified).toBe(false);
  });

  it("records failed delivery without flipping notified when WAHA fails", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    const client = fakeClient({ alwaysFail: true });
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client,
      today: TODAY,
    });
    expect(batch).not.toBeNull();
    expect(getCustomer(c.id).notified).toBe(false);
    expect(
      db
        .select()
        .from(notificationDeliveries)
        .all()
        .some((d) => d.status === "failed"),
    ).toBe(true);
  });

  it("retry_batch re-sends failed deliveries and flips notified on success", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    const failing = fakeClient({ alwaysFail: true });
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client: failing,
      today: TODAY,
    });
    expect(getCustomer(c.id).notified).toBe(false);

    const ok = fakeClient();
    await retryBatch({ batchId: batch!.id, client: ok, today: TODAY });
    expect(getCustomer(c.id).notified).toBe(true);
    const salesmanDelivery = db
      .select()
      .from(notificationDeliveries)
      .all()
      .find((d) => d.salesmanId === salesman.id);
    expect(salesmanDelivery?.status).toBe("sent");
  });

  it("deleteBatch removes the batch, deliveries, and clears notified", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    const batch = await triggerBatch({
      triggeredById: admin.id,
      client: fakeClient(),
      today: TODAY,
    });
    expect(batch).not.toBeNull();
    expect(getCustomer(c.id).notified).toBe(true);
    deleteBatch(batch!.id);
    expect(
      db
        .select()
        .from(notificationBatches)
        .where(eq(notificationBatches.id, batch!.id))
        .get(),
    ).toBeUndefined();
    expect(
      db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.batchId, batch!.id))
        .all(),
    ).toHaveLength(0);
    expect(getCustomer(c.id).notified).toBe(false);
  });
});

describe("submitReason (FR-7/FR-8, BR-4)", () => {
  beforeEach(() => resetDb());

  it("clears pending state for non-bankrupt codes without changing status", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
      notified: true,
    });
    submitReason({
      customerId: c.id,
      kodeAlasan: "1",
      actingUserId: salesmanUser.id,
    });
    const updated = getCustomer(c.id);
    expect(updated.notified).toBe(false);
    expect(updated.statusCustomer).toBe("aktif");
    expect(updated.handledOn).toBeTruthy();
    expect(
      db.select().from(reasonLogs).where(eq(reasonLogs.customerId, c.id)).all(),
    ).toHaveLength(1);
    expect(db.select().from(statusLogs).all()).toHaveLength(0);
  });

  it("marks Sudah Bangkrut as Inactive and logs manual_inactive", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      notified: true,
      lastOrderDate: "2026-07-01",
    });
    submitReason({
      customerId: c.id,
      kodeAlasan: "3",
      actingUserId: salesmanUser.id,
    });
    expect(getCustomer(c.id).statusCustomer).toBe("inactive");
    expect(getCustomer(c.id).notified).toBe(false);
    const logs = db.select().from(statusLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0].tipe).toBe("manual_inactive");
  });
});
