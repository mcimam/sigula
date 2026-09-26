import { beforeEach, describe, expect, it } from "vitest";

import { sqlite } from "~/db/client.server";
import { db } from "~/db/client.server";
import { activityLogs } from "~/db/schema";
import { listActivityPage, logActivity } from "~/lib/activity.server";
import { listAssignmentMovesPage, listStatusChangesPage, recordStatusChange } from "~/lib/customer-history.server";
import { reassignCustomer } from "~/lib/masterdata.server";

import { addCustomer, resetDb, seedOrg } from "./helpers/fixtures";

const labelsOf = (opts: Parameters<typeof listActivityPage>[0]) =>
  listActivityPage(opts).rows.map((r) => r.entityLabel);

describe("Log Audit — activity entries paged and searched in SQL", () => {
  beforeEach(() => resetDb());

  /** Four entries by different people on different records, oldest first. */
  async function fourEntries() {
    const { admin, salesmanUser } = await seedOrg();
    logActivity({ entityType: "customer", entityId: 1, entityLabel: "Toko Maju", action: "update", actorId: admin.id, changes: { order_cycle_days: { from: 30, to: 14 } } });
    logActivity({ entityType: "transaksi", entityId: 9, entityLabel: "Order Warung", action: "create", actorId: admin.id, changes: { catatan: { from: null, to: "kirim pagi" } } });
    logActivity({ entityType: "salesman", entityId: 2, entityLabel: "Imam", action: "delete", actorId: admin.id, changes: { nama: { from: "Imam", to: null } } });
    logActivity({ entityType: "customer", entityId: 3, entityLabel: "Kios Sentosa", action: "update", actorId: salesmanUser.id, changes: { alasan_keterlambatan: { from: null, to: "Kalah Harga" } } });
  }

  it("lists newest first and filters by record type", async () => {
    await fourEntries();
    expect(labelsOf({ page: 1, pageSize: 10 })).toEqual(["Kios Sentosa", "Imam", "Order Warung", "Toko Maju"]);
    expect(labelsOf({ entity: "customer", page: 1, pageSize: 10 })).toEqual(["Kios Sentosa", "Toko Maju"]);
  });

  it("searches the record's name and who did it", async () => {
    await fourEntries();
    expect(labelsOf({ q: "maju", page: 1, pageSize: 10 })).toEqual(["Toko Maju"]);
    expect(labelsOf({ q: "andi", page: 1, pageSize: 10 })).toEqual(["Kios Sentosa"]);
  });

  it("searches what the page shows in Indonesian: record type, action, field name", async () => {
    await fourEntries();
    expect(labelsOf({ q: "transaksi", page: 1, pageSize: 10 })).toEqual(["Order Warung"]);
    expect(labelsOf({ q: "dihapus", page: 1, pageSize: 10 })).toEqual(["Imam"]);
    expect(labelsOf({ q: "dibuat", page: 1, pageSize: 10 })).toEqual(["Order Warung"]);
    expect(labelsOf({ q: "siklus", page: 1, pageSize: 10 })).toEqual(["Toko Maju"]);
    expect(labelsOf({ q: "alasan keterlambatan", page: 1, pageSize: 10 })).toEqual(["Kios Sentosa"]);
  });

  it("searches the before and after values", async () => {
    await fourEntries();
    expect(labelsOf({ q: "kirim pagi", page: 1, pageSize: 10 })).toEqual(["Order Warung"]);
    expect(labelsOf({ q: "kalah harga", page: 1, pageSize: 10 })).toEqual(["Kios Sentosa"]);
    expect(labelsOf({ q: "14", page: 1, pageSize: 10 })).toEqual(["Toko Maju"]); // an "after" number
  });

  it("does not match the JSON structure around the values", async () => {
    await fourEntries();
    // every stored entry contains these words as JSON keys; none of them is something the user sees
    expect(listActivityPage({ q: "from", page: 1, pageSize: 10 }).total).toBe(0);
    expect(listActivityPage({ q: "{", page: 1, pageSize: 10 }).total).toBe(0);
  });

  it("treats % and _ as plain characters", async () => {
    await fourEntries();
    expect(listActivityPage({ q: "%", page: 1, pageSize: 10 }).total).toBe(0);
    expect(listActivityPage({ q: "_", page: 1, pageSize: 10 }).total).toBe(0);
    logActivity({ entityType: "customer", entityId: 5, entityLabel: "Diskon 50%", action: "create", changes: { nama: { from: null, to: "x" } } });
    expect(labelsOf({ q: "50%", page: 1, pageSize: 10 })).toEqual(["Diskon 50%"]);
  });

  it("a row whose changes are not valid JSON is still listed and does not break the search", async () => {
    await fourEntries();
    db.insert(activityLogs)
      .values({ entityType: "customer", entityId: 7, entityLabel: "Rusak", action: "update", changes: "bukan json", createdAt: "2026-09-01T00:00:00Z" })
      .run();
    expect(listActivityPage({ page: 1, pageSize: 10 }).total).toBe(5);
    expect(labelsOf({ q: "rusak", page: 1, pageSize: 10 })).toEqual(["Rusak"]);
    expect(labelsOf({ q: "maju", page: 1, pageSize: 10 })).toEqual(["Toko Maju"]);
  });

  it("pages by SQL: no cap on how much history there is, and a page past the end lands on the last", async () => {
    for (let i = 1; i <= 25; i++) {
      logActivity({ entityType: "customer", entityId: i, entityLabel: `C${i}`, action: "create", changes: { nama: { from: null, to: `C${i}` } } });
    }
    const pages = [1, 2, 3].map((page) => listActivityPage({ page, pageSize: 10 }));
    expect(pages.map((p) => p.rows.length)).toEqual([10, 10, 5]);
    expect(pages[0].rows[0].entityLabel).toBe("C25");
    expect(pages[2].rows[4].entityLabel).toBe("C1");
    expect(pages.every((p) => p.total === 25 && p.totalPages === 3)).toBe(true);
    expect(listActivityPage({ page: 99, pageSize: 10 }).page).toBe(3);
    // the filter narrows the total the pager shows
    expect(listActivityPage({ q: "c2", page: 1, pageSize: 10 }).total).toBe(7); // C2, C20..C25
  });

  it("uses json1 (the search depends on it)", () => {
    expect(sqlite.prepare("SELECT json_extract('{\"a\":1}', '$.a') AS v").get()).toEqual({ v: 1 });
  });
});

describe("Log Audit — customer moves and status changes, paged", () => {
  beforeEach(() => resetDb());

  it("a customer's first assignment is not a move; each later handover is, newest first", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    reassignCustomer({ customerId: c.id, toSalesmanId: salesmanB.id, actingUserId: admin.id });
    reassignCustomer({ customerId: c.id, toSalesmanId: salesman.id, actingUserId: admin.id });

    const all = listAssignmentMovesPage(1, 10);
    expect(all.total).toBe(2);
    expect(all.rows.map((m) => [m.fromSalesmanId, m.toSalesmanId])).toEqual([
      [salesmanB.id, salesman.id],
      [salesman.id, salesmanB.id],
    ]);

    const first = listAssignmentMovesPage(1, 1);
    const second = listAssignmentMovesPage(2, 1);
    expect([first.totalPages, second.page]).toEqual([2, 2]);
    expect(first.rows[0].id).not.toBe(second.rows[0].id);
    expect(listAssignmentMovesPage(9, 1).page).toBe(2);
  });

  it("pages the status changes newest first", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    recordStatusChange(db, { customerId: c.id, from: "aktif", to: "inactive", reason: "manual_inactive", changedById: admin.id });
    recordStatusChange(db, { customerId: c.id, from: "inactive", to: "aktif", reason: "manual_reactivation", changedById: admin.id });
    recordStatusChange(db, { customerId: c.id, from: "aktif", to: "inactive", reason: "manual_inactive", changedById: null });

    const page1 = listStatusChangesPage(1, 2);
    const page2 = listStatusChangesPage(2, 2);
    expect([page1.total, page1.totalPages, page1.rows.length, page2.rows.length]).toEqual([3, 2, 2, 1]);
    expect(page1.rows[0].changedById).toBeNull(); // the last one written comes first
    expect(page2.rows[0].reason).toBe("manual_inactive");
  });
});
