import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { activityLogs, customers, recordComments, transaksi } from "~/db/schema";
import { addComment, listFeedFor } from "~/lib/activity.server";
import { COMMENT_MAX_LENGTH } from "~/lib/activity-format";
import { postNote } from "~/lib/comments.server";
import { nowIso } from "~/lib/dates";
import { reasonCounts } from "~/lib/follow-ups.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import { recordOrder } from "~/lib/orders.server";

import { addCustomer, createUser, grantsOf, logsFor, resetDb, seedOrg } from "./helpers/fixtures";

const T = (n: number) => `2026-09-01T00:00:${String(n).padStart(2, "0")}Z`;

function logAt(entityId: number, createdAt: string, label = "log") {
  db.insert(activityLogs)
    .values({ entityType: "customer", entityId, entityLabel: label, action: "update", changes: "{}", createdAt })
    .run();
}
function commentAt(entityId: number, createdAt: string, body = "komentar") {
  db.insert(recordComments)
    .values({ entityType: "customer", entityId, body, authorName: "Maya Chen", createdAt })
    .run();
}
/** Records an order for the customer and returns the new transaksi's id. */
function orderFor(customerId: number, actingUserId: number) {
  recordOrder({ customerId, actingUserId, tanggalOrder: "2026-09-01", sumber: "manual" });
  return db.select({ id: transaksi.id }).from(transaksi).where(eq(transaksi.customerId, customerId)).get()!.id;
}

/** What a thrown `Response` says: its status, or `null` when nothing was thrown / it was not a Response. */
function thrownStatus(fn: () => void): number | null {
  try {
    fn();
  } catch (e) {
    return e instanceof Response ? e.status : -1;
  }
  return null;
}

describe("comments", () => {
  beforeEach(() => resetDb());

  it("stores the trimmed text with the author's name as it was", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    addComment({ entityType: "customer", entityId: c.id, body: "  Sudah ditelpon\n", authorId: admin.id });

    const [entry] = listFeedFor("customer", c.id).entries;
    expect(entry.kind).toBe("comment");
    expect(entry.item).toMatchObject({ body: "Sudah ditelpon", authorName: "Admin" });
  });

  it("refuses an empty comment and one over the limit, and stores neither", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const post = (body: string) => () => addComment({ entityType: "customer", entityId: c.id, body, authorId: admin.id });

    expect(post("")).toThrow(/kosong/);
    expect(post("   \n ")).toThrow(/kosong/);
    expect(post("x".repeat(COMMENT_MAX_LENGTH + 1))).toThrow(/maksimal/);
    expect(listFeedFor("customer", c.id).total).toBe(0);

    post("x".repeat(COMMENT_MAX_LENGTH))(); // exactly at the limit is fine
    expect(listFeedFor("customer", c.id).total).toBe(1);
  });
});

describe("a record's feed", () => {
  beforeEach(() => resetDb());

  it("puts log entries and comments in one list, newest first, for that record only", () => {
    logAt(1, T(1), "dibuat");
    commentAt(1, T(2), "pertama");
    logAt(1, T(3), "diubah");
    commentAt(2, T(4), "milik record lain");
    logAt(2, T(5), "milik record lain");

    const feed = listFeedFor("customer", 1);
    expect(feed.total).toBe(3);
    expect(feed.entries.map((e) => (e.kind === "log" ? e.item.entityLabel : e.item.body))).toEqual([
      "diubah",
      "pertama",
      "dibuat",
    ]);
  });

  it("within the same second a comment comes before the log entry, so 'reason, then message' reads in order", () => {
    logAt(1, T(5), "alasan");
    commentAt(1, T(5), "pesan");
    expect(listFeedFor("customer", 1).entries.map((e) => e.kind)).toEqual(["comment", "log"]);
  });

  it("pages across both tables with no gap and no repeat", () => {
    // 25 entries interleaved: even seconds are log entries, odd ones comments.
    for (let i = 1; i <= 25; i++) (i % 2 ? commentAt : logAt)(1, T(i), `e${i}`);

    const pages = [1, 2, 3].map((p) => listFeedFor("customer", 1, p, 10));
    expect(pages.map((p) => p.entries.length)).toEqual([10, 10, 5]);
    expect(pages.every((p) => p.total === 25 && p.totalPages === 3)).toBe(true);

    const labels = pages.flatMap((p) => p.entries.map((e) => (e.kind === "log" ? e.item.entityLabel : e.item.body)));
    expect(labels).toEqual(Array.from({ length: 25 }, (_, i) => `e${25 - i}`));
  });

  it("a page past the end lands on the last one; an empty record is one empty page", () => {
    for (let i = 1; i <= 12; i++) commentAt(1, T(i));
    expect(listFeedFor("customer", 1, 99, 10)).toMatchObject({ page: 2, entries: expect.any(Array) });
    expect(listFeedFor("customer", 1, 99, 10).entries).toHaveLength(2);
    expect(listFeedFor("customer", 1, 0, 10).page).toBe(1);
    expect(listFeedFor("customer", 42)).toEqual({ entries: [], total: 0, page: 1, totalPages: 1 });
  });
});

describe("posting to a record's thread", () => {
  beforeEach(() => resetDb());

  async function org() {
    const o = await seedOrg();
    const other = createUser("citra", "Citra", ["salesman"], o.salesmanB.id);
    return {
      ...o,
      adminAuth: await grantsOf(o.admin.id),
      salesmanAuth: await grantsOf(o.salesmanUser.id),
      otherAuth: await grantsOf(other.id),
    };
  }

  it("an admin can comment on any kind of record", async () => {
    const { adminAuth, admin, salesman } = await org();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const transaksiId = orderFor(c.id, admin.id);

    for (const [entityType, entityId] of [
      ["customer", c.id],
      ["transaksi", transaksiId],
      ["salesman", salesman.id],
      ["user", admin.id],
    ] as const) {
      postNote({ user: adminAuth, entityType, entityId, body: `catatan ${entityType}` });
      expect(listFeedFor(entityType, entityId).entries.some((e) => e.kind === "comment"), entityType).toBe(true);
    }
  });

  it("a salesman can comment on their own customer, and on nothing else", async () => {
    const { salesmanAuth, salesman, salesmanB, admin } = await org();
    const mine = addCustomer({ salesmanId: salesman.id, nama: "Milik saya" });
    const theirs = addCustomer({ salesmanId: salesmanB.id, nama: "Milik Citra" });
    const transaksiId = orderFor(mine.id, admin.id);

    postNote({ user: salesmanAuth, entityType: "customer", entityId: mine.id, body: "halo" });
    expect(listFeedFor("customer", mine.id).total).toBe(1);

    const post = (entityType: "customer" | "transaksi" | "salesman" | "user", entityId: number) => () =>
      postNote({ user: salesmanAuth, entityType, entityId, body: "coba" });
    expect(thrownStatus(post("customer", theirs.id))).toBe(403);
    expect(thrownStatus(post("transaksi", transaksiId))).toBe(403);
    expect(thrownStatus(post("salesman", salesman.id))).toBe(403);
    expect(thrownStatus(post("user", admin.id))).toBe(403);
    expect(listFeedFor("customer", theirs.id).total).toBe(0);
  });

  it("a record that does not exist, or is in the trash, is a 404", async () => {
    const { adminAuth, salesman } = await org();
    const trashed = addCustomer({ salesmanId: salesman.id, nama: "Dibuang" });
    db.update(customers).set({ deletedAt: nowIso() }).where(eq(customers.id, trashed.id)).run();

    const post = (entityType: "customer" | "transaksi" | "salesman" | "user", entityId: number) => () =>
      postNote({ user: adminAuth, entityType, entityId, body: "coba" });
    expect(thrownStatus(post("customer", 99999))).toBe(404);
    expect(thrownStatus(post("customer", trashed.id))).toBe(404);
    expect(thrownStatus(post("transaksi", 99999))).toBe(404);
    expect(thrownStatus(post("salesman", 99999))).toBe(404);
    expect(thrownStatus(post("user", 99999))).toBe(404);
  });

  it("a late customer's reason is logged on the customer, ends the reminder, and the message follows it", async () => {
    const { salesmanAuth, salesman } = await org();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true });
    expect(pendingCustomerIds().has(c.id)).toBe(true);

    postNote({ user: salesmanAuth, entityType: "customer", entityId: c.id, body: "Harga kompetitor lebih murah", reasonCode: "1" });

    expect(pendingCustomerIds().has(c.id)).toBe(false);
    expect(reasonCounts().find((r) => r.code === "1")?.count).toBe(1);
    const [logged] = logsFor("customer", c.id);
    expect(logged.changes).toEqual({ alasan_keterlambatan: { from: null, to: "Kalah Harga" } });
    expect(logged.actorName).toBe("Andi");
    // newest first: the message, then the reason it explains
    expect(listFeedFor("customer", c.id).entries.map((e) => e.kind)).toEqual(["comment", "log"]);
  });

  it("a reason on its own needs no message; a message on its own leaves the reminder pending", async () => {
    const { salesmanAuth, salesman } = await org();
    const a = addCustomer({ salesmanId: salesman.id, nama: "A", pending: true });
    const b = addCustomer({ salesmanId: salesman.id, nama: "B", pending: true });

    postNote({ user: salesmanAuth, entityType: "customer", entityId: a.id, body: "", reasonCode: "2" });
    postNote({ user: salesmanAuth, entityType: "customer", entityId: b.id, body: "akan dihubungi besok" });

    expect(listFeedFor("customer", a.id).entries.map((e) => e.kind)).toEqual(["log"]);
    expect(pendingCustomerIds().has(a.id)).toBe(false);
    expect(pendingCustomerIds().has(b.id)).toBe(true);
  });

  it("the deactivating reason still deactivates, in the same log entry as the reason", async () => {
    const { salesmanAuth, salesman } = await org();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Tutup", pending: true });
    postNote({ user: salesmanAuth, entityType: "customer", entityId: c.id, body: "", reasonCode: "3" });

    const [logged] = logsFor("customer", c.id);
    expect(Object.keys(logged.changes).sort()).toEqual(["alasan_keterlambatan", "status_customer"]);
  });

  it("only someone who may follow the customer up can give a reason — nothing is written otherwise", async () => {
    const { adminAuth, otherAuth, salesman, salesmanB } = await org();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true });
    const withReason = (user: typeof adminAuth) => () =>
      postNote({ user, entityType: "customer", entityId: c.id, body: "alasan", reasonCode: "1" });

    expect(thrownStatus(withReason(adminAuth))).toBe(403); // the admin role has no customer.follow_up
    expect(thrownStatus(withReason(otherAuth))).toBe(403); // another salesman's customer
    expect(salesmanB.id).not.toBe(salesman.id);
    expect(listFeedFor("customer", c.id).total).toBe(0);
    expect(reasonCounts().every((r) => r.count === 0)).toBe(true);
    expect(pendingCustomerIds().has(c.id)).toBe(true);
  });

  it("bad input is refused before anything is written", async () => {
    const { salesmanAuth, salesman, admin, adminAuth } = await org();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", pending: true });
    const post = (over: Partial<Parameters<typeof postNote>[0]>) => () =>
      postNote({ user: salesmanAuth, entityType: "customer", entityId: c.id, body: "", ...over });

    expect(post({})).toThrow(/kosong/); // neither text nor reason
    expect(post({ reasonCode: "9", body: "ada pesan" })).toThrow(/Alasan tidak valid/);
    expect(post({ reasonCode: "1", body: "x".repeat(COMMENT_MAX_LENGTH + 1) })).toThrow(/maksimal/);
    expect(() => postNote({ user: adminAuth, entityType: "user", entityId: admin.id, body: "x", reasonCode: "1" })).toThrow(/hanya untuk customer/);

    expect(listFeedFor("customer", c.id).total).toBe(0);
    expect(reasonCounts().every((r) => r.count === 0)).toBe(true);
    expect(pendingCustomerIds().has(c.id)).toBe(true);
  });
});
