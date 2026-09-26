import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { and, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { notificationDeliveries, notificationItems, notificationRuns, permissions, rolePermissions, roles } from "~/db/schema";
import { handleWahaEvent, type InboundDeps } from "~/lib/inbound.server";
import { submitReason } from "~/lib/follow-ups.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import { RESEND_COOLDOWN_MINUTES, resendReminder, triggerBatch } from "~/lib/reminders.server";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { saveWahaSettings } from "~/lib/settings.server";
import { action } from "~/routes/admin.masterdata";
import type { WahaClient } from "~/lib/waha.server";

import { addCustomer, createUser, logsFor, requestAs, resetDb, seedOrg } from "./helpers/fixtures";

const TODAY = "2026-08-22";

/** A WAHA client that records what it is asked to send. */
function fakeClient(opts?: { fail?: boolean }) {
  const sent: { to: string; text: string }[] = [];
  const client: WahaClient = {
    async sendText(to, text) {
      sent.push({ to, text });
      return opts?.fail ? { ok: false, errorMessage: "down" } : { ok: true, messageId: `wamid.${sent.length}` };
    },
  };
  return { client, sent };
}
/** The customer's reminder items on messages to its salesman (the supervisor's summary lists the customer too). */
const salesmanItemsOf = (customerId: number) =>
  db
    .select({ id: notificationItems.id })
    .from(notificationItems)
    .innerJoin(notificationDeliveries, eq(notificationDeliveries.id, notificationItems.deliveryId))
    .where(and(eq(notificationItems.customerId, customerId), eq(notificationDeliveries.recipientKind, "salesman")))
    .all();
const runs = () => db.select().from(notificationRuns).all();
const deliveries = () => db.select().from(notificationDeliveries).all();

describe("resendReminder — one more reminder for one overdue customer", () => {
  beforeEach(() => resetDb());

  it("sends the usual message, a list of one, to the customer's salesman only — and records it", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "ES TELER", lastOrderDate: "2026-03-24" });
    const { client, sent } = fakeClient();

    const result = await resendReminder({ customerId: c.id, triggeredById: admin.id, client, today: TODAY });

    expect(result).toMatchObject({ salesmanName: "Andi Sales" });
    expect(sent).toHaveLength(1); // no summary to the supervisor
    expect(sent[0].to).toBe("628222222222");
    expect(sent[0].text).toContain("🔔 Reminder Customer Anda [Andi Sales] — 22 Agu 2026");
    expect(sent[0].text).toContain("Ada 1 customer yang sudah melewati siklus order normalnya:\n1. ES TELER — 151 hari (siklus normal 30 hari)");
    expect(sent[0].text).toContain("Cara membalas");

    const [run] = runs();
    expect(run).toMatchObject({ trigger: "manual", triggeredById: admin.id, asOfDate: TODAY });
    expect(run.voidedAt).toBeNull();
    expect(run.finishedAt).not.toBeNull();
    const [d] = deliveries();
    expect(d).toMatchObject({ salesmanId: salesman.id, recipientKind: "salesman", status: "sent", customerCount: 1, address: "628222222222" });
    expect(db.select().from(notificationItems).where(eq(notificationItems.deliveryId, d.id)).all()).toMatchObject([{ customerId: c.id, position: 1 }]);
    expect(pendingCustomerIds().has(c.id)).toBe(true);
    const [entry] = logsFor("customer", c.id);
    expect(entry.changes).toEqual({ pengingat_dikirim: { from: null, to: "Andi Sales (WhatsApp)" } });
    expect(entry.actorName).toBe("Admin");
  });

  it("reminds a customer that was already reminded and is still waiting", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient().client, today: TODAY });
    expect(pendingCustomerIds().has(c.id)).toBe(true);
    const { client, sent } = fakeClient();

    await resendReminder({ customerId: c.id, triggeredById: admin.id, client, today: TODAY, now: new Date(Date.now() + 60 * 60_000) });

    expect(sent).toHaveLength(1);
    expect(salesmanItemsOf(c.id)).toHaveLength(2);
  });

  it("answering the reminder that was sent again ends the wait — the earlier one does not keep the customer pending", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient().client, today: TODAY });
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client: fakeClient().client, today: TODAY, now: new Date(Date.now() + 60 * 60_000) });

    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });

    expect(pendingCustomerIds().has(c.id)).toBe(false);
  });

  it("a reply on WhatsApp to the first message still answers the customer, whichever reminder it quotes", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const first = fakeClient();
    await triggerBatch({ triggeredById: admin.id, client: first.client, today: TODAY }); // wamid.1 → salesman
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client: fakeClient().client, today: TODAY, now: new Date(Date.now() + 60 * 60_000) });
    const out = fakeClient();
    const deps: InboundDeps = { client: out.client, lookupLid: async () => null };
    const message = (body: string, replyTo: string | null) => ({
      event: "message",
      session: "default",
      payload: { id: `m-${body}-${replyTo}`, from: "628222222222@c.us", fromMe: false, body, timestamp: 1790000000, replyTo: replyTo ? { id: replyTo } : null },
    });

    const result = await handleWahaEvent(message("Barang masih ada", "wamid.1"), deps);

    expect(result).toMatchObject({ outcome: "recorded" });
    expect(pendingCustomerIds().has(c.id)).toBe(false);
  });

  it("refuses, before anything is written or sent, what should not be reminded", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const { client, sent } = fakeClient();
    const ok = addCustomer({ salesmanId: salesman.id, nama: "Ok", lastOrderDate: "2026-03-24" });
    const fresh = addCustomer({ salesmanId: salesman.id, nama: "Belum", lastOrderDate: "2026-08-01" }); // 21 days of a 30-day cycle
    const edge = addCustomer({ salesmanId: salesman.id, nama: "Tepat", lastOrderDate: "2026-07-23" }); // exactly the cycle: not overdue
    const off = addCustomer({ salesmanId: salesman.id, nama: "Off", lastOrderDate: "2026-03-24", statusCustomer: "inactive" });
    const noWa = addCustomer({ salesmanId: salesmanB.id, nama: "TanpaWa", lastOrderDate: "2026-03-24" });
    setWhatsappNumber(salesmanB.id, ""); // Citra has no number
    const resend = (id: number) => () => resendReminder({ customerId: id, triggeredById: admin.id, client, today: TODAY });

    await expect(resend(fresh.id)()).rejects.toThrow(/belum overdue/);
    await expect(resend(edge.id)()).rejects.toThrow(/belum overdue/);
    await expect(resend(off.id)()).rejects.toThrow(/inactive/);
    await expect(resend(noWa.id)()).rejects.toThrow(/Citra Sales belum punya nomor WhatsApp/);
    await expect(resend(99999)()).rejects.toThrow(/tidak ditemukan/);

    expect(sent).toHaveLength(0);
    expect(runs()).toHaveLength(0);
    expect(deliveries()).toHaveLength(0);
    expect(logsFor("customer", ok.id)).toHaveLength(0);
    expect(logsFor("customer", noWa.id)).toHaveLength(0);
  });

  it("not twice within 10 minutes; fine after", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const { client, sent } = fakeClient();
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client, today: TODAY });

    await expect(resendReminder({ customerId: c.id, triggeredById: admin.id, client, today: TODAY })).rejects.toThrow(/tunggu 10 menit/);
    expect(sent).toHaveLength(1);
    expect(runs()).toHaveLength(1);

    const later = new Date(Date.now() + (RESEND_COOLDOWN_MINUTES + 1) * 60_000);
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client, today: TODAY, now: later });
    expect(sent).toHaveLength(2);
  });

  it("when WhatsApp cannot send: says so, keeps the failed delivery as a record, voids the run, logs nothing", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });

    await expect(resendReminder({ customerId: c.id, triggeredById: admin.id, client: fakeClient({ fail: true }).client, today: TODAY })).rejects.toThrow(
      "Pengingat gagal dikirim ke Andi Sales: down",
    );

    const [run] = runs();
    expect(run.voidedAt).not.toBeNull(); // no "retry" is offered: a retry would skip this customer
    expect(run.voidReason).toBe("Kirim ulang gagal: down");
    expect(deliveries()[0]).toMatchObject({ status: "failed", errorMessage: "down" });
    expect(pendingCustomerIds().has(c.id)).toBe(false);
    expect(logsFor("customer", c.id)).toHaveLength(0);

    // …and the admin can simply try again (the failed one does not count as a reminder)
    const again = fakeClient();
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client: again.client, today: TODAY });
    expect(again.sent).toHaveLength(1);
  });
});

describe("pending: only a customer's newest reminder decides", () => {
  beforeEach(() => resetDb());

  it("an older unanswered reminder is superseded by a newer one; answering the newer one ends the wait", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient().client, today: TODAY });
    expect(pendingCustomerIds().has(c.id)).toBe(true);
    await resendReminder({ customerId: c.id, triggeredById: admin.id, client: fakeClient().client, today: TODAY, now: new Date(Date.now() + 3_600_000) });
    expect(pendingCustomerIds().has(c.id)).toBe(true);

    submitReason({ customerId: c.id, kodeAlasan: "2", actingUserId: salesmanUser.id });

    expect(pendingCustomerIds().has(c.id)).toBe(false);
    expect(salesmanItemsOf(c.id)).toHaveLength(2); // both rows stay as the record
  });

  it("answered once, reminded again: pending again (as before)", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient().client, today: TODAY });
    submitReason({ customerId: c.id, kodeAlasan: "1", actingUserId: salesmanUser.id });
    expect(pendingCustomerIds().has(c.id)).toBe(false);

    await resendReminder({ customerId: c.id, triggeredById: admin.id, client: fakeClient().client, today: TODAY, now: new Date(Date.now() + 3_600_000) });

    expect(pendingCustomerIds().has(c.id)).toBe(true);
  });
});

describe("numbers saved the way people write them (the production 500)", () => {
  beforeEach(() => {
    resetDb();
    saveWahaSettings({ baseUrl: "http://waha.test", session: "Sigula", timeoutMs: 3000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubWaha = (respond?: () => Response) => {
    const chats: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: { body?: string }) => {
      chats.push(JSON.parse(String(init?.body)).chatId);
      return respond ? respond() : new Response(JSON.stringify({ id: "wamid.x" }), { status: 201 });
    });
    return chats;
  };

  it("a number saved as 0822-… is sent to 62822… — the reminder goes through instead of WAHA answering 500", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "0822-2222-222"); // 628222222222 as people write it
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const chats = stubWaha();

    await resendReminder({ customerId: c.id, triggeredById: admin.id, today: TODAY });

    expect(chats).toEqual(["628222222222@c.us"]);
    expect(deliveries()[0]).toMatchObject({ status: "sent", address: "0822-2222-222" }); // saved as typed, sent normalised
  });

  it("the same for a whole batch", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "08222222222");
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const chats = stubWaha();

    await triggerBatch({ triggeredById: admin.id, today: TODAY });

    expect(chats).toContain("628222222222@c.us");
    expect(chats.every((chat) => !chat.startsWith("0"))).toBe(true);
  });

  it("when WAHA still refuses, the reason WAHA gave is in the message and on the delivery", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    stubWaha(() => new Response('{"message":"No LID for user"}', { status: 500, statusText: "Internal Server Error" }));

    await expect(resendReminder({ customerId: c.id, triggeredById: admin.id, today: TODAY })).rejects.toThrow(
      'Pengingat gagal dikirim ke Andi Sales: WAHA returned 500: Internal Server Error — {"message":"No LID for user"}',
    );
    expect(deliveries()[0].errorMessage).toContain("No LID for user");
  });

  it("a number that cannot be a WhatsApp number is refused with its name, before anything is written or asked of WAHA", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "0812");
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const chats = stubWaha();

    await expect(resendReminder({ customerId: c.id, triggeredById: admin.id, today: TODAY })).rejects.toThrow(
      "Nomor WhatsApp Andi Sales tidak valid (0812)",
    );

    expect(chats).toHaveLength(0);
    expect(runs()).toHaveLength(0);
  });

  it("in a batch it is skipped with the reason, not sent", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "abc");
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const chats = stubWaha();

    await triggerBatch({ triggeredById: admin.id, today: TODAY });

    expect(chats.filter((chat) => chat.includes("abc"))).toHaveLength(0);
    const mine = deliveries().find((d) => d.recipientKind === "salesman")!;
    expect(mine).toMatchObject({ status: "skipped_no_contact", errorMessage: "Nomor WhatsApp tidak valid: abc" });
    expect(pendingCustomerIds().size).toBe(0); // nobody was reminded, so nobody waits
  });

  it("a reply is recognised whichever way the salesman's number was saved", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient().client, today: TODAY });
    const out = fakeClient();
    const deps: InboundDeps = { client: out.client, lookupLid: async () => null };
    const reply = (n: number) => ({ event: "message", session: "Sigula", payload: { id: `m${n}`, from: "628222222222@c.us", fromMe: false, body: "Kalah Harga", timestamp: 1790000000 } });

    for (const [i, saved] of ["0822-2222-222", "+62 822 2222 222", "8222222222"].entries()) {
      setWhatsappNumber(salesman.id, saved);
      const result = await handleWahaEvent(reply(i), deps);
      expect(result, saved).toMatchObject({ status: "handled" });
      expect((result as { outcome: string }).outcome, saved).not.toBe("unknown_sender");
    }
    expect(pendingCustomerIds().has(c.id)).toBe(false); // the first one recorded it
  });
});

describe("the menu action in Data Master", () => {
  beforeEach(() => {
    resetDb();
    saveWahaSettings({ baseUrl: "http://waha.test", session: "default", timeoutMs: 3000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubWaha = () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ id: "wamid.web" }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    return calls;
  };
  const post = async (userId: number, fields: Record<string, string>) => {
    const cookie = (await requestAs(userId)).headers.get("Cookie")!;
    const body = new URLSearchParams(fields);
    return action({ request: new Request("http://localhost/admin/masterdata", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body }) } as never);
  };
  const flashOf = (res: unknown) => {
    const url = new URL((res as Response).headers.get("Location")!);
    return { edit: url.searchParams.get("edit"), tab: url.searchParams.get("tab"), flash: url.searchParams.get("flash") };
  };

  it("an admin sends it, and lands back on the same customer's panel with the result", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "CV Baru", lastOrderDate: "2026-03-24" });
    const calls = stubWaha();

    const res = await post(admin.id, { intent: "resend_reminder", customer_id: String(c.id) });

    expect(flashOf(res)).toEqual({ edit: String(c.id), tab: "customer", flash: "Pengingat dikirim ke Andi Sales" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://waha.test/api/sendText");
    expect(JSON.parse(calls[0].body)).toMatchObject({ chatId: "628222222222@c.us" });
    expect(JSON.parse(calls[0].body).text).toContain("1. CV Baru");
    expect(deliveries()).toHaveLength(1);
  });

  it("a refusal comes back as a message on the same panel, and nothing is sent", async () => {
    const { admin, salesman } = await seedOrg();
    const fresh = addCustomer({ salesmanId: salesman.id, nama: "Baru order", lastOrderDate: "2099-01-01" });
    const calls = stubWaha();

    const res = await post(admin.id, { intent: "resend_reminder", customer_id: String(fresh.id) });

    expect(flashOf(res)).toEqual({ edit: String(fresh.id), tab: "customer", flash: "Customer belum overdue" });
    expect(calls).toHaveLength(0);
    expect(runs()).toHaveLength(0);
  });

  it("someone who may edit master data but not send notifications gets a 403 and nothing is sent; so does a salesman", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    const calls = stubWaha();
    const perm = db.select().from(permissions).where(eq(permissions.code, "masterdata.manage")).get()!;
    const role = db.insert(roles).values({ code: "hanya-master", name: "Hanya master data" }).returning().get();
    try {
      db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id, scope: "all" }).run();
      const editor = createUser("editor", "Editor", ["hanya-master"]);

      for (const who of [editor.id, salesmanUser.id]) {
        const status = await post(who, { intent: "resend_reminder", customer_id: String(c.id) }).then(
          () => "returned",
          (e) => (e instanceof Response ? e.status : String(e)),
        );
        expect(status, String(who)).toBe(403);
      }
      expect(calls).toHaveLength(0);
      expect(runs()).toHaveLength(0);
    } finally {
      db.delete(roles).where(eq(roles.id, role.id)).run(); // reference data: leave it as it was
    }
  });
});
