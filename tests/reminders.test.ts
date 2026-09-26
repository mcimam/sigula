import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  customerStatusHistory,
  customers,
  followUps,
  messageTemplates,
  notificationDeliveries,
  notificationItems,
  notificationRuns,
} from "~/db/schema";
import { sqlite } from "~/db/client.server";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { nowIso } from "~/lib/dates";
import { deleteCustomerRecord } from "~/lib/masterdata.server";
import { recordOrder } from "~/lib/orders.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import {
  eligibleCustomerCount,
  previewBatch,
  retryBatch,
  runsPage,
  triggerBatch,
  voidBatch,
} from "~/lib/reminders.server";
import { findFollowUpReason, listFollowUpReasons, reasonCounts, submitReason } from "~/lib/follow-ups.server";
import type { WahaClient } from "~/lib/waha.server";

import { TODAY, addCustomer, isPending, resetDb, seedOrg, voidRunLegacy } from "./helpers/fixtures";
import { replyInstructions } from "./helpers/reminder-text";

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
      return { ok: true, messageId: `wamid.${calls.length}` };
    },
  };
}

const deliveriesOf = (runId: number) =>
  db.select().from(notificationDeliveries).where(eq(notificationDeliveries.runId, runId)).all();

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
    const run = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    expect(run).toBeNull();
    expect(client.calls).toHaveLength(0);
    expect(db.select().from(notificationRuns).all()).toHaveLength(0);
  });

  it("sends to salesman + supervisor and makes customers pending on the salesman's success", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko A", lastOrderDate: "2026-07-01" });
    addCustomer({ salesmanId: salesman.id, nama: "Toko B", lastOrderDate: null });

    const client = fakeClient();
    const run = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    expect(run).toMatchObject({ trigger: "manual", triggeredById: admin.id, asOfDate: TODAY });
    expect(run!.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(client.calls).toHaveLength(2);

    const deliveries = deliveriesOf(run!.id);
    expect(deliveries.every((d) => d.status === "sent" && d.sentAt !== null)).toBe(true);
    expect(deliveries.every((d) => d.attempt === 1 && d.channel === "whatsapp")).toBe(true);

    const pending = pendingCustomerIds();
    expect(
      db.select().from(customers).all().filter((c) => pending.has(c.id)).map((c) => c.nama).sort(),
    ).toEqual(["Toko A", "Toko B"]);
  });

  it("records what was sent: text, address, template, provider id and the customers covered", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    const a = addCustomer({ salesmanId: salesman.id, nama: "Toko A", lastOrderDate: "2026-07-01", orderCycleDays: 30 });
    const b = addCustomer({ salesmanId: salesman.id, nama: "Toko B", lastOrderDate: null });

    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    const toSalesman = deliveriesOf(run!.id).find((d) => d.recipientKind === "salesman")!;
    expect(toSalesman).toMatchObject({
      salesmanId: salesman.id,
      address: "628222222222",
      customerCount: 2,
      providerMessageId: "wamid.1",
      messageBody: [
        "🔔 Reminder Customer Anda [Andi Sales] — 12 Sep 2026",
        "",
        "Ada 2 customer yang sudah melewati siklus order normalnya:",
        "1. Toko B — belum pernah order (siklus normal 30 hari)",
        "2. Toko A — 73 hari (siklus normal 30 hari)",
        "",
        ...replyInstructions("Kalah Harga / Stok Masih Ada / Sudah Bangkrut"),
      ].join("\n"),
    });
    expect(toSalesman.templateId).not.toBeNull();
    expect(toSalesman.contactId).not.toBeNull();

    const items = db.select().from(notificationItems).where(eq(notificationItems.deliveryId, toSalesman.id)).all();
    expect(items.map((i) => i.customerId).sort()).toEqual([a.id, b.id].sort());
    const itemA = items.find((i) => i.customerId === a.id)!;
    expect(itemA).toMatchObject({ lastOrderDate: "2026-07-01", daysOverdue: 73 - 30 }); // 2026-07-01 → 2026-09-12
    expect(items.find((i) => i.customerId === b.id)).toMatchObject({ lastOrderDate: null, daysOverdue: 0 });

    const toSupervisor = deliveriesOf(run!.id).find((d) => d.recipientKind === "supervisor")!;
    expect(toSupervisor).toMatchObject({ salesmanId: supervisor.id, customerCount: 2 });
    expect(toSupervisor.messageBody.startsWith("Ringkasan tim Budi Supervisor")).toBe(true);
  });

  it("second trigger is a no-op once customers are pending (FR-3 regression)", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const client = fakeClient();
    const first = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    expect(first).not.toBeNull();
    const callsAfterFirst = client.calls.length;

    const second = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    expect(second).toBeNull();
    expect(client.calls.length).toBe(callsAfterFirst);
    expect(eligibleCustomerCount(TODAY)).toBe(0);
  });

  it("preview excludes customers that are already pending", async () => {
    const { salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Pending", lastOrderDate: "2026-07-01", pending: true });
    addCustomer({ salesmanId: salesman.id, nama: "FreshOverdue", lastOrderDate: "2026-07-01" });
    const preview = previewBatch(TODAY);
    expect(preview.salesmen).toHaveLength(1);
    expect(preview.salesmen[0].customers.map((c) => c.nama)).toEqual(["FreshOverdue"]);
    expect(preview.salesmen[0].salesman.nomorWa).toBe("628222222222");
  });

  it("a run started by the scheduler has no person behind it", async () => {
    const { salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: null, client: fakeClient(), today: TODAY });
    expect(run).toMatchObject({ trigger: "scheduled", triggeredById: null });
  });

  it("skips recipients without a WhatsApp contact, writes no items and leaves nobody pending", async () => {
    const { admin, salesman } = await seedOrg({ salesmanWa: "", supervisorWa: "" });
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const client = fakeClient();
    const run = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    expect(run).not.toBeNull();
    expect(client.calls).toHaveLength(0);
    const deliveries = deliveriesOf(run!.id);
    expect(deliveries.every((d) => d.status === "skipped_no_contact" && d.customerCount === 1)).toBe(true);
    expect(db.select().from(notificationItems).all()).toHaveLength(0);
    expect(isPending(c.id)).toBe(false);
  });

  it("records a failed delivery (with items) that does not make anyone pending", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    expect(run).not.toBeNull();
    expect(isPending(c.id)).toBe(false);
    const failed = deliveriesOf(run!.id).filter((d) => d.status === "failed");
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ errorMessage: "down", sentAt: null });
    expect(db.select().from(notificationItems).all().length).toBeGreaterThan(0);
  });

  it("fails before writing anything when a template is missing", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    db.update(messageTemplates).set({ isActive: false }).where(eq(messageTemplates.channel, "whatsapp")).run();
    await expect(
      triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY }),
    ).rejects.toThrow(/Template reminder_salesman\/whatsapp tidak ditemukan/);
    expect(db.select().from(notificationRuns).all()).toHaveLength(0);
  });
});

describe("pending: how a reminder stops waiting", () => {
  beforeEach(() => resetDb());

  async function reminded() {
    const org = await seedOrg();
    const c = addCustomer({ salesmanId: org.salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: org.admin.id, client: fakeClient(), today: TODAY });
    expect(isPending(c.id)).toBe(true);
    return { ...org, c, run: run! };
  }

  it("ends with a follow-up", async () => {
    const { c, salesmanUser } = await reminded();
    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });
    expect(isPending(c.id)).toBe(false);
  });

  it("ends with a newer order", async () => {
    const { c, salesmanUser } = await reminded();
    recordOrder({ customerId: c.id, actingUserId: salesmanUser.id, tanggalOrder: TODAY });
    expect(isPending(c.id)).toBe(false);
  });

  it("does not end with an order older than the last one (the cycle did not restart)", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: null });
    recordOrder({ customerId: c.id, actingUserId: admin.id, tanggalOrder: "2026-07-01" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    expect(isPending(c.id)).toBe(true);

    recordOrder({ customerId: c.id, actingUserId: salesmanUser.id, tanggalOrder: "2026-05-01" });
    expect(isPending(c.id)).toBe(true);
  });

  it("ends when the customer is deleted, and returns if it is restored", async () => {
    const { c, admin } = await reminded();
    deleteCustomerRecord(c.id, admin.id);
    expect(isPending(c.id)).toBe(false);
  });

  it("is not caused by a supervisor summary alone", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    const own = addCustomer({ salesmanId: supervisor.id, nama: "Milik SPV", lastOrderDate: "2026-09-10" });
    addCustomer({ salesmanId: salesman.id, nama: "Tim", lastOrderDate: "2026-07-01" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    // The supervisor received a summary, but their own (not overdue) customer was never on a salesman message.
    expect(isPending(own.id)).toBe(false);
  });
});

describe("retryBatch", () => {
  beforeEach(() => resetDb());

  it("re-sends failed deliveries as a new attempt, keeps the failed row, and makes the customer pending", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    expect(isPending(c.id)).toBe(false);

    await retryBatch({ batchId: run!.id, client: fakeClient(), today: TODAY });

    const mine = deliveriesOf(run!.id).filter((d) => d.salesmanId === salesman.id);
    expect(mine.map((d) => [d.attempt, d.status])).toEqual([[1, "failed"], [2, "sent"]]);
    expect(isPending(c.id)).toBe(true);
  });

  it("does not retry a delivery whose latest attempt succeeded, and is idempotent", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    const ok = fakeClient();
    await retryBatch({ batchId: run!.id, client: ok, today: TODAY });
    const before = deliveriesOf(run!.id).length;
    await retryBatch({ batchId: run!.id, client: ok, today: TODAY });
    expect(deliveriesOf(run!.id)).toHaveLength(before);
  });

  it("drops customers that were handled in the meantime, and skips a delivery left with nobody", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    recordOrder({ customerId: c.id, actingUserId: salesmanUser.id, tanggalOrder: TODAY });

    const client = fakeClient();
    await retryBatch({ batchId: run!.id, client, today: TODAY });
    expect(client.calls).toHaveLength(0);
    expect(deliveriesOf(run!.id).every((d) => d.attempt === 1)).toBe(true);
  });

  it("a retried supervisor summary counts the customers a salesman retry just covered", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });

    const client = fakeClient();
    await retryBatch({ batchId: run!.id, client, today: TODAY });
    const summary = client.calls.find((c) => c.nomorWa === "628111111111" && c.text.startsWith("Ringkasan tim"))!;
    expect(summary.text).toBe("Ringkasan tim Budi Supervisor: 1 customer overdue perlu ditindaklanjuti.");
    expect(supervisor.id).toBeGreaterThan(0);
  });

  it("uses the recipient's current number, not the one from the first attempt", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    setWhatsappNumber(salesman.id, "628999");
    await retryBatch({ batchId: run!.id, client: fakeClient(), today: TODAY });
    const attempts = deliveriesOf(run!.id).filter((d) => d.salesmanId === salesman.id);
    expect(attempts.map((d) => d.address)).toEqual(["628222222222", "628999"]);
  });

  it("refuses a run that was voided, or one that does not exist", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    voidBatch({ batchId: run!.id, voidedById: admin.id });
    await expect(retryBatch({ batchId: run!.id, client: fakeClient(), today: TODAY })).rejects.toThrow(/dibatalkan/);
    await expect(retryBatch({ batchId: 9999, client: fakeClient(), today: TODAY })).rejects.toThrow(/tidak ditemukan/);
  });
});

describe("voidBatch (cancel a run that delivered nothing)", () => {
  beforeEach(() => resetDb());

  const failedRun = async () => {
    const { admin, salesman } = await seedOrg();
    const customer = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    return { admin, salesman, customer, run: run! };
  };

  it("keeps the run and its rows on record, with who cancelled it and why", async () => {
    const { admin, run } = await failedRun();

    voidBatch({ batchId: run.id, voidedById: admin.id, reason: "  salah nomor " });

    const after = db.select().from(notificationRuns).where(eq(notificationRuns.id, run.id)).get()!;
    expect(after).toMatchObject({ voidedById: admin.id, voidReason: "salah nomor" });
    expect(after.voidedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(deliveriesOf(run.id).length).toBeGreaterThan(0);
  });

  it("refuses a run whose message was sent — a sent message cannot be taken back", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });

    expect(() => voidBatch({ batchId: run!.id, voidedById: admin.id })).toThrow(/sudah terkirim/);

    const after = db.select().from(notificationRuns).where(eq(notificationRuns.id, run!.id)).get()!;
    expect(after.voidedAt).toBeNull();
    expect(isPending(c.id)).toBe(true);
  });

  it.each([
    ["the supervisor's summary failed", "628111111111"],
    ["the salesman's message failed", "628222222222"],
  ])("refuses a run as soon as one message went out: %s", async (_label, failingNumber) => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    // seedOrg: the salesman is 628222222222, the supervisor 628111111111.
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ failFor: [failingNumber] }), today: TODAY });
    expect(deliveriesOf(run!.id).map((d) => d.status).sort()).toEqual(["failed", "sent"]);

    expect(() => voidBatch({ batchId: run!.id, voidedById: admin.id })).toThrow(/sudah terkirim/);
  });

  it("refuses a run once a retry has delivered it", async () => {
    const { admin, run } = await failedRun();
    await retryBatch({ batchId: run.id, client: fakeClient(), today: TODAY });

    expect(() => voidBatch({ batchId: run.id, voidedById: admin.id })).toThrow(/sudah terkirim/);
  });

  it("allows a run where nobody could be reached — nothing was sent", async () => {
    const { admin, salesman } = await seedOrg({ salesmanWa: "", supervisorWa: "" });
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    expect(deliveriesOf(run!.id).every((d) => d.status === "skipped_no_contact")).toBe(true);

    voidBatch({ batchId: run!.id, voidedById: admin.id });

    expect(db.select().from(notificationRuns).where(eq(notificationRuns.id, run!.id)).get()!.voidedAt).not.toBeNull();
  });

  it("cannot be done twice", async () => {
    const { admin, run } = await failedRun();
    voidBatch({ batchId: run.id, voidedById: admin.id });
    expect(() => voidBatch({ batchId: run.id, voidedById: admin.id })).toThrow(/sudah dibatalkan/);
  });

  it("refuses a run that does not exist", async () => {
    const { admin } = await seedOrg();
    expect(() => voidBatch({ batchId: 9999, voidedById: admin.id })).toThrow(/tidak ditemukan/);
  });
});

describe("a run voided under the old rule (pending.server.ts)", () => {
  beforeEach(() => resetDb());

  it("keeps its rows on record but frees its customers to be reminded again", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const run = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    expect(isPending(c.id)).toBe(true);

    voidRunLegacy(run!.id, admin.id);

    expect(deliveriesOf(run!.id).length).toBeGreaterThan(0);
    expect(isPending(c.id)).toBe(false);
    expect(eligibleCustomerCount(TODAY)).toBe(1);
    const again = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    expect(again!.id).not.toBe(run!.id);
    expect(isPending(c.id)).toBe(true);
  });

  it("only affects customers reminded by that run", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const a = addCustomer({ salesmanId: salesman.id, nama: "A", lastOrderDate: "2026-07-01" });
    const first = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    const b = addCustomer({ salesmanId: salesmanB.id, nama: "B", lastOrderDate: "2026-07-01" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });

    voidRunLegacy(first!.id, admin.id);
    expect(isPending(a.id)).toBe(false);
    expect(isPending(b.id)).toBe(true);
  });
});

describe("runsPage (the dashboard's history)", () => {
  beforeEach(() => resetDb());

  const insertRuns = (n: number, triggeredById: number) =>
    Array.from({ length: n }, () =>
      db
        .insert(notificationRuns)
        .values({ trigger: "manual", triggeredById, asOfDate: TODAY, startedAt: nowIso() })
        .returning()
        .get().id,
    );

  it("pages newest first and reports where it is", async () => {
    const { admin } = await seedOrg();
    const ids = insertRuns(7, admin.id); // ascending: the last one is the newest

    const first = runsPage(1, 5);
    expect(first).toMatchObject({ total: 7, page: 1, totalPages: 2, pageSize: 5 });
    expect(first.rows.map((r) => r.id)).toEqual([ids[6], ids[5], ids[4], ids[3], ids[2]]);

    const second = runsPage(2, 5);
    expect(second).toMatchObject({ total: 7, page: 2, totalPages: 2 });
    expect(second.rows.map((r) => r.id)).toEqual([ids[1], ids[0]]);
  });

  it("clamps a stale page to the last one instead of showing nothing", async () => {
    const { admin } = await seedOrg();
    insertRuns(7, admin.id);
    const stale = runsPage(9, 5);
    expect(stale.page).toBe(2);
    expect(stale.rows).toHaveLength(2);
  });

  it("is one empty page when nothing was ever sent", () => {
    resetDb();
    expect(runsPage(3)).toMatchObject({ rows: [], total: 0, page: 1, totalPages: 1 });
  });

  it("carries each run's deliveries with names, whether it needs a retry, and whether it was voided", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const failed = await triggerBatch({ triggeredById: admin.id, client: fakeClient({ alwaysFail: true }), today: TODAY });
    voidBatch({ batchId: failed!.id, voidedById: admin.id, reason: "salah nomor" });
    const ok = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });

    const [newest, older] = runsPage(1).rows;
    expect(newest.id).toBe(ok!.id);
    expect(newest.needsRetry).toBe(false);
    expect(newest.voidedAt).toBeNull();
    // The salesman's message, then the summary to the direct supervisor (seedOrg's team).
    expect(newest.deliveries.map((d) => [d.name, d.recipientKind, d.status])).toEqual([
      ["Andi Sales", "salesman", "sent"],
      ["Budi Supervisor", "supervisor", "sent"],
    ]);
    expect(older.id).toBe(failed!.id);
    expect(older.needsRetry).toBe(true);
    expect(older.voidReason).toBe("salah nomor");
    expect(older.deliveries.map((d) => d.status)).toEqual(["failed", "failed"]);
  });
});

describe("the reminder text to a salesman", () => {
  beforeEach(() => resetDb());

  const sentToSalesman = async (adminId: number, today: string) => {
    const client = fakeClient();
    await triggerBatch({ triggeredById: adminId, client, today });
    return client.calls.find((c) => c.nomorWa === "628222222222")!.text; // the salesman's number in seedOrg
  };

  it("reads as header, numbered list (longest wait first) and the reasons to answer with", async () => {
    const { admin, salesman } = await seedOrg();
    // Deliberately not in the order they will be listed.
    addCustomer({ salesmanId: salesman.id, nama: "DWI SADONO", lastOrderDate: "2026-07-21" }); // 32 days
    addCustomer({ salesmanId: salesman.id, nama: "ES TELER NEISYA", lastOrderDate: "2026-03-24" }); // 151
    addCustomer({ salesmanId: salesman.id, nama: "SUPRIHATIN", lastOrderDate: "2026-04-06" }); // 138
    const client = fakeClient();

    await triggerBatch({ triggeredById: admin.id, client, today: "2026-08-22" });

    expect(client.calls.find((c) => c.nomorWa === "628222222222")!.text).toBe(
      [
        "🔔 Reminder Customer Anda [Andi Sales] — 22 Agu 2026",
        "",
        "Ada 3 customer yang sudah melewati siklus order normalnya:",
        "1. ES TELER NEISYA — 151 hari (siklus normal 30 hari)",
        "2. SUPRIHATIN — 138 hari (siklus normal 30 hari)",
        "3. DWI SADONO — 32 hari (siklus normal 30 hari)",
        "",
        ...replyInstructions("Kalah Harga / Stok Masih Ada / Sudah Bangkrut"),
      ].join("\n"),
    );
  });

  it("each customer shows its own cycle", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko Cepat", lastOrderDate: "2026-09-01", orderCycleDays: 7 });
    expect(await sentToSalesman(admin.id, "2026-09-12")).toContain("1. Toko Cepat — 11 hari (siklus normal 7 hari)");
  });

  it("lists the reasons that are on offer now, not the ones it once had", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    sqlite.exec("UPDATE follow_up_reasons SET is_active = 0 WHERE code = '2'");
    try {
      expect(await sentToSalesman(admin.id, TODAY)).toContain("Pilihan alasan: Kalah Harga / Sudah Bangkrut.");
    } finally {
      sqlite.exec("UPDATE follow_up_reasons SET is_active = 1 WHERE code = '2'");
    }
  });

  it("the supervisor's summary keeps its own, shorter text", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const client = fakeClient();
    await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    const summary = client.calls.find((c) => c.nomorWa === "628111111111")!.text;
    expect(summary).toBe("Ringkasan tim Budi Supervisor: 1 customer overdue perlu ditindaklanjuti.");
  });
});

describe("submitReason (FR-7/FR-8, BR-4)", () => {
  it("the salesman's own words are a reason too: kept as the note, shown in the activity, never a deactivation", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true });

    submitReason({ customerId: c.id, kodeAlasan: "other", note: "  Barang masih ada  ", actingUserId: salesmanUser.id });

    const [f] = db.select().from(followUps).where(eq(followUps.customerId, c.id)).all();
    expect(f).toMatchObject({ note: "Barang masih ada", outcome: "not_ordering" });
    expect(f.reasonId).toBe(findFollowUpReason("other")!.id);
    expect(isPending(c.id)).toBe(false);
    expect(db.select().from(customerStatusHistory).all()).toHaveLength(0);
    expect(listFollowUpReasons().map((r) => r.code)).not.toContain("other"); // never offered as a choice
  });

  it("needs the words when the reason is 'Lainnya'", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true });
    expect(() => submitReason({ customerId: c.id, kodeAlasan: "other", note: "   ", actingUserId: salesmanUser.id })).toThrow(/Alasan lain perlu diisi/);
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });

  beforeEach(() => resetDb());

  it("records a follow-up linked to the reminder, ends pending, and leaves the status alone", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    const item = db.select().from(notificationItems).where(eq(notificationItems.customerId, c.id)).all()[0];

    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });

    const [followUp] = db.select().from(followUps).where(eq(followUps.customerId, c.id)).all();
    expect(followUp).toMatchObject({
      salesmanId: salesman.id,
      outcome: "not_ordering",
      notificationItemId: item.id,
      createdById: salesmanUser.id,
    });
    expect(followUp.reasonId).toBe(findFollowUpReason("1")!.id);
    expect(followUp.followUpDate).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(isPending(c.id)).toBe(false);
    expect(db.select().from(customers).where(eq(customers.id, c.id)).get()!.statusCustomer).toBe("aktif");
    expect(db.select().from(customerStatusHistory).all()).toHaveLength(0);
  });

  it("marks Sudah Bangkrut as Inactive and records the transition", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true, lastOrderDate: "2026-07-01" });
    submitReason({ customerId: c.id, kodeAlasan: "3", actingUserId: salesmanUser.id });
    expect(db.select().from(customers).where(eq(customers.id, c.id)).get()!.statusCustomer).toBe("inactive");
    expect(isPending(c.id)).toBe(false);
    const logs = db.select().from(customerStatusHistory).all();
    expect(logs).toHaveLength(1);
    expect([logs[0].fromStatus, logs[0].toStatus]).toEqual(["aktif", "inactive"]);
    expect(logs[0].reason).toBe("manual_inactive");
  });

  it("does not record a transition for a customer that is already inactive", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", statusCustomer: "inactive" });
    submitReason({ customerId: c.id, kodeAlasan: "3", actingUserId: salesmanUser.id });
    expect(db.select().from(customerStatusHistory).all()).toHaveLength(0);
    expect(db.select().from(followUps).all()).toHaveLength(1);
  });

  it("a follow-up without a pending reminder simply has no item", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    submitReason({ customerId: c.id, kodeAlasan: "2", actingUserId: salesmanUser.id });
    expect(db.select().from(followUps).all()[0].notificationItemId).toBeNull();
  });

  it("rejects an unknown reason code and a customer that does not exist", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    expect(() => submitReason({ customerId: c.id, kodeAlasan: "9", actingUserId: salesmanUser.id })).toThrow(/Alasan tidak valid/);
    expect(() => submitReason({ customerId: 9999, kodeAlasan: "1", actingUserId: salesmanUser.id })).toThrow(/not found/);
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });

  it("counts how often each reason was chosen, reasons nobody chose included", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });
    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });
    expect(reasonCounts()).toEqual([
      { code: "1", label: "Kalah Harga", count: 2 },
      { code: "2", label: "Stok Masih Ada", count: 0 },
      { code: "3", label: "Sudah Bangkrut", count: 0 },
      { code: "other", label: "Lainnya", count: 0 }, // answers in the salesman's own words
    ]);
  });
});
