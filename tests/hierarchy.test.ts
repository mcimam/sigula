import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, notificationDeliveries, salesmen } from "~/db/schema";
import {
  assertValidSupervisor,
  createSalesman,
  deleteSalesman,
  deleteSalesmenMany,
  directReportIds,
  salesmenWithStats,
  subordinateIds,
  supervisorsWithStats,
  updateSalesman,
} from "~/lib/masterdata.server";
import { previewBatch, retryBatch, triggerBatch } from "~/lib/reminders.server";

import { TODAY, addCustomer, isPending, resetDb, seedOrg, voidRunLegacy } from "./helpers/fixtures";

/** A → B → C (B reports to A, C reports to B). */
function chain() {
  const a = createSalesman({ nama: "A", nomorWa: "6281" });
  const b = createSalesman({ nama: "B", nomorWa: "6282", supervisorId: a.id });
  const c = createSalesman({ nama: "C", nomorWa: "6283", supervisorId: b.id });
  return { a, b, c };
}

describe("salesman hierarchy (ADR-0004)", () => {
  beforeEach(() => resetDb());

  it("subordinateIds spans every depth, directReportIds only one level", () => {
    const { a, b, c } = chain();
    expect(subordinateIds(a.id).sort()).toEqual([b.id, c.id].sort());
    expect(subordinateIds(b.id)).toEqual([c.id]);
    expect(subordinateIds(c.id)).toEqual([]);
    expect(directReportIds(a.id)).toEqual([b.id]);
  });

  it("rejects a salesman as their own supervisor", () => {
    const { a } = chain();
    expect(() => assertValidSupervisor(a.id, a.id)).toThrow(/dirinya sendiri/);
  });

  it("rejects a link that would form a cycle", () => {
    const { a, c } = chain();
    expect(() =>
      updateSalesman({
        id: a.id,
        nama: "A",
        nomorWa: "6281",
        supervisorId: c.id,
        status: "aktif",
      }),
    ).toThrow(/siklus/);
    expect(db.select().from(salesmen).where(eq(salesmen.id, a.id)).get()!.supervisorId).toBeNull();
  });

  it("rejects an unknown supervisor", () => {
    expect(() => assertValidSupervisor(null, 99999)).toThrow(/tidak ditemukan/);
  });

  it("the DB itself refuses a self-referencing row", () => {
    const { a } = chain();
    expect(() =>
      db.update(salesmen).set({ supervisorId: a.id }).where(eq(salesmen.id, a.id)).run(),
    ).toThrow();
  });

  it("supervisor team stats cover the whole subtree, excluding the supervisor", () => {
    const { a, b, c } = chain();
    addCustomer({ salesmanId: a.id, nama: "own", lastOrderDate: "2026-01-01" });
    addCustomer({ salesmanId: b.id, nama: "b1", lastOrderDate: "2026-01-01" });
    addCustomer({ salesmanId: c.id, nama: "c1", lastOrderDate: "2026-01-01" });

    const team = salesmenWithStats(a.id);
    expect(team.map((s) => s.id).sort()).toEqual([b.id, c.id].sort());
    expect(team.reduce((n, s) => n + s.aktif, 0)).toBe(2);
  });

  it("management overview is a partition: each salesman under exactly one supervisor", () => {
    const { a, b, c } = chain();
    addCustomer({ salesmanId: b.id, nama: "b1", lastOrderDate: "2026-01-01" });
    addCustomer({ salesmanId: c.id, nama: "c1", lastOrderDate: "2026-01-01" });

    const rows = supervisorsWithStats();
    const rowA = rows.find((r) => r.id === a.id)!;
    const rowB = rows.find((r) => r.id === b.id)!;
    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(rowA.salesmanCount).toBe(1); // only B
    expect(rowA.aktif).toBe(1);
    expect(rowB.salesmanCount).toBe(1); // only C
    expect(rowB.aktif).toBe(1);
    expect(rows.reduce((n, r) => n + r.aktif, 0)).toBe(2); // no double counting
  });

  it("can't delete a salesman that still has subordinates", () => {
    const { a } = chain();
    expect(() => deleteSalesman(a.id)).toThrow(/bawahan/);
  });

  it("deleting a supervisor together with all their subordinates works, children first", () => {
    const { a, b, c } = chain();
    deleteSalesmenMany([a.id, b.id, c.id]);
    expect(db.select().from(salesmen).where(alive(salesmen)).all()).toHaveLength(0);
  });

  it("a batch that leaves a subordinate behind is rejected as a whole", () => {
    const { a, b, c } = chain();
    expect(() => deleteSalesmenMany([a.id, b.id])).toThrow(/bawahan/);
    expect(db.select().from(salesmen).where(alive(salesmen)).all().map((s) => s.id).sort()).toEqual(
      [a.id, b.id, c.id].sort(),
    );
  });
});

describe("supervisor notifications with a salesman supervisor", () => {
  beforeEach(() => resetDb());

  function fakeClient() {
    const calls: { to: string; text: string }[] = [];
    return {
      calls,
      sendText: async (to: string, text: string) => {
        calls.push({ to, text });
        return { ok: true as const };
      },
    };
  }

  it("sends the team summary to the direct supervisor as its own delivery", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });

    const preview = previewBatch(TODAY);
    expect(preview.supervisors.map((s) => s.supervisor.id)).toEqual([supervisor.id]);

    const client = fakeClient();
    const batch = await triggerBatch({ triggeredById: admin.id, client, today: TODAY });
    const deliveries = db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.runId, batch!.id))
      .all();
    expect(deliveries.map((d) => [d.salesmanId, d.recipientKind]).sort()).toEqual(
      [
        [salesman.id, "salesman"],
        [supervisor.id, "supervisor"],
      ].sort(),
    );
  });

  it("a supervisor who also has own overdue customers gets two separate messages", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "TeamCust", lastOrderDate: "2026-07-01" });
    addCustomer({ salesmanId: supervisor.id, nama: "OwnCust", lastOrderDate: "2026-07-01" });

    const client = fakeClient();
    await triggerBatch({ triggeredById: admin.id, client, today: TODAY });

    const toSupervisor = client.calls.filter((c) => c.to === "628111111111");
    expect(toSupervisor).toHaveLength(2);
    expect(toSupervisor.some((c) => c.text.includes("OwnCust"))).toBe(true);
    expect(toSupervisor.some((c) => c.text.startsWith("Ringkasan tim"))).toBe(true);
  });

  it("a batch voided under the old rule frees only the customers its salesman messages reminded", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    // A customer that is notified for an unrelated reason and belongs to the
    // supervisor, who only appears in this batch as a *summary* recipient.
    const own = addCustomer({
      salesmanId: supervisor.id,
      nama: "OwnNotified",
      lastOrderDate: "2026-09-10",
      pending: true,
    });
    const team = addCustomer({ salesmanId: salesman.id, nama: "TeamPending", lastOrderDate: "2026-07-01" });

    const batch = await triggerBatch({ triggeredById: admin.id, client: fakeClient(), today: TODAY });
    expect(isPending(team.id)).toBe(true);
    voidRunLegacy(batch!.id, admin.id);

    expect(isPending(team.id)).toBe(false);
    // Pending because of an earlier, unrelated reminder — untouched by voiding this batch.
    expect(isPending(own.id)).toBe(true);
  });

  it("retrying a failed supervisor delivery resends the summary, not the salesman message", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });

    const failing = { sendText: async () => ({ ok: false as const, errorMessage: "down" }) };
    const batch = await triggerBatch({ triggeredById: admin.id, client: failing, today: TODAY });

    const client = fakeClient();
    await retryBatch({ batchId: batch!.id, client, today: TODAY });
    const summaries = client.calls.filter((c) => c.text.startsWith("Ringkasan tim"));
    expect(summaries).toHaveLength(1);
    expect(summaries[0].to).toBe("628111111111");
  });
});
