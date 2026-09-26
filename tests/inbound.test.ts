import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, followUps, inboundMessages, notificationItems, recordComments } from "~/db/schema";
import { composeConfirmation, handleWahaEvent, receiveReply, verifyWebhookSignature, type InboundDeps } from "~/lib/inbound.server";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { reassignCustomer } from "~/lib/masterdata.server";
import { reasonCounts } from "~/lib/follow-ups.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import { triggerBatch } from "~/lib/reminders.server";
import type { WahaClient } from "~/lib/waha.server";

import { addCustomer, logsFor, resetDb, seedOrg } from "./helpers/fixtures";

const TODAY = "2026-08-22";
const SALESMAN_WA = "628222222222"; // seedOrg's salesman

/** A WAHA client that records what it is asked to send, and hands out ids `wamid.1`, `wamid.2`, … */
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

let nextId = 0;
/** A WAHA `message` event. */
function message(body: string, over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  return {
    event: "message",
    session: "default",
    payload: { id: `false_${SALESMAN_WA}@c.us_${++nextId}`, from: `${SALESMAN_WA}@c.us`, fromMe: false, body, timestamp: 1790000000, replyTo: null, ...over },
    ...top,
  };
}

/**
 * The org, with three overdue customers of the salesman who has been sent a reminder:
 * 1. ES TELER (151 days) 2. SUPRIHATIN (138 days) 3. DWI SADONO (32 days).
 */
async function reminded() {
  const org = await seedOrg();
  const [a, b, c] = [
    addCustomer({ salesmanId: org.salesman.id, nama: "ES TELER", lastOrderDate: "2026-03-24" }),
    addCustomer({ salesmanId: org.salesman.id, nama: "SUPRIHATIN", lastOrderDate: "2026-04-06" }),
    addCustomer({ salesmanId: org.salesman.id, nama: "DWI SADONO", lastOrderDate: "2026-07-21" }),
  ];
  const wa = fakeClient();
  const run = (await triggerBatch({ triggeredById: org.admin.id, client: wa.client, today: TODAY }))!;
  const out = fakeClient();
  const deps: InboundDeps = { client: out.client, lookupLid: async () => null, now: new Date("2026-08-22T03:00:00Z") };
  return { ...org, customers: { a, b, c }, run, out, deps };
}
const followUpsOf = (customerId: number) => db.select().from(followUps).where(eq(followUps.customerId, customerId)).all();
const statusOf = (customerId: number) => db.select().from(customers).where(eq(customers.id, customerId)).get()!.statusCustomer;

describe("verifyWebhookSignature", () => {
  const secret = "s3cret";
  const body = '{"event":"message"}';
  const hmac = (enc: "hex" | "base64", key = secret, text = body) => crypto.createHmac("sha512", key).update(text).digest(enc);

  it("accepts the HMAC-SHA512 of the body, in hex or base64", () => {
    expect(verifyWebhookSignature(body, hmac("hex"), secret)).toBe(true);
    expect(verifyWebhookSignature(body, hmac("hex").toUpperCase(), secret)).toBe(true);
    expect(verifyWebhookSignature(body, hmac("base64"), secret)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, hmac("hex", "other"), secret)).toBe(false); // another key
    expect(verifyWebhookSignature(body + " ", hmac("hex"), secret)).toBe(false); // a changed body
    expect(verifyWebhookSignature(body, hmac("hex").slice(0, -2), secret)).toBe(false);
    expect(verifyWebhookSignature(body, hmac("hex"), "")).toBe(false); // no secret configured
    expect(verifyWebhookSignature(body, crypto.createHmac("sha256", secret).update(body).digest("hex"), secret)).toBe(false);
  });
});

describe("a salesman answering a reminder on WhatsApp", () => {
  beforeEach(() => resetDb());

  it("stores each customer's number in the message with the reminder", async () => {
    const { run, customers: c } = await reminded();
    void run;
    const positions = db.select().from(notificationItems).all().map((i) => [i.customerId, i.position]);
    expect(Object.fromEntries(positions)).toEqual({ [c.a.id]: 1, [c.b.id]: 2, [c.c.id]: 3 });
  });

  it("records one customer by its number, logs it as coming from WhatsApp, and confirms", async () => {
    const { customers: c, deps, out } = await reminded();

    const result = await handleWahaEvent(message("2 Kalah Harga"), deps);

    expect(result).toMatchObject({ status: "handled", outcome: "recorded", replied: true });
    expect(followUpsOf(c.b.id)).toHaveLength(1);
    expect(followUpsOf(c.a.id)).toHaveLength(0);
    expect(pendingCustomerIds().has(c.b.id)).toBe(false);
    expect(pendingCustomerIds().has(c.a.id)).toBe(true);
    const [entry] = logsFor("customer", c.b.id);
    expect(entry.changes).toEqual({ alasan_keterlambatan: { from: null, to: "Kalah Harga (via WhatsApp)" } });
    expect(entry.actorName).toBe("Andi"); // the salesman's own login
    expect(out.sent).toEqual([
      { to: SALESMAN_WA, text: "✅ Tercatat: 1 customer\n2. SUPRIHATIN — Kalah Harga\nSisa menunggu balasan: 2 customer." },
    ]);
    const [row] = db.select().from(inboundMessages).all();
    expect(row).toMatchObject({ outcome: "recorded", replyStatus: "sent", fromAddress: SALESMAN_WA, body: "2 Kalah Harga" });
  });

  it("without a number, answers every customer of that reminder still waiting", async () => {
    const { customers: c, deps, out } = await reminded();

    await handleWahaEvent(message("Stok Masih Ada"), deps);

    for (const id of [c.a.id, c.b.id, c.c.id]) expect(followUpsOf(id), String(id)).toHaveLength(1);
    expect(pendingCustomerIds().size).toBe(0);
    expect(out.sent[0].text).toContain("✅ Tercatat: 3 customer");
    expect(out.sent[0].text).toContain("Semua customer di reminder ini sudah dijawab.");
  });

  it("several numbers and ranges at once; a message can mix numbered and unnumbered lines", async () => {
    const { customers: c, deps } = await reminded();

    await handleWahaEvent(message("1 Sudah Bangkrut\nKalah Harga"), deps);

    expect(statusOf(c.a.id)).toBe("inactive"); // the numbered line
    expect(statusOf(c.b.id)).toBe("aktif"); // the unnumbered line covers the rest, without deactivating
    expect(followUpsOf(c.b.id)).toHaveLength(1);
    expect(followUpsOf(c.c.id)).toHaveLength(1);
    expect(logsFor("customer", c.a.id)[0].changes).toEqual({
      alasan_keterlambatan: { from: null, to: "Sudah Bangkrut (via WhatsApp)" },
      status_customer: { from: "aktif", to: "inactive" },
    });
  });

  it("'2-3' and '1,3' address several customers", async () => {
    const { customers: c, deps } = await reminded();
    await handleWahaEvent(message("2-3 Kalah Harga"), deps);
    expect([c.a, c.b, c.c].map((x) => followUpsOf(x.id).length)).toEqual([0, 1, 1]);
    await handleWahaEvent(message("1 Stok Masih Ada"), deps);
    expect(followUpsOf(c.a.id)).toHaveLength(1);
  });

  it("says so for a number that is not in the list or already answered, and still records the rest", async () => {
    const { customers: c, deps, out } = await reminded();
    await handleWahaEvent(message("1 Kalah Harga"), deps);

    await handleWahaEvent(message("1,2,9 Stok Masih Ada"), deps);

    expect(followUpsOf(c.a.id)).toHaveLength(1); // 1 was answered before, and not again
    expect(followUpsOf(c.b.id)).toHaveLength(1);
    const reply = out.sent[1].text;
    expect(reply).toContain("✅ Tercatat: 1 customer");
    expect(reply).toContain("⚠️ Nomor 1 sudah dijawab.");
    expect(reply).toContain("⚠️ Nomor 9 tidak ada di daftar.");
  });

  it("nothing recorded when every number is wrong", async () => {
    const { customers: c, deps, out } = await reminded();
    const result = await handleWahaEvent(message("7 Kalah Harga"), deps);

    expect(result).toMatchObject({ outcome: "nothing_pending" });
    expect(out.sent[0].text).toContain("⚠️ Nomor 7 tidak ada di daftar.");
    expect([c.a, c.b, c.c].flatMap((x) => followUpsOf(x.id))).toHaveLength(0);
  });

  it("a customer that changed hands since the reminder is not the sender's to answer", async () => {
    const { customers: c, deps, out, admin, salesmanB } = await reminded();
    reassignCustomer({ customerId: c.a.id, toSalesmanId: salesmanB.id, actingUserId: admin.id });

    await handleWahaEvent(message("1-2 Kalah Harga"), deps);

    expect(followUpsOf(c.a.id)).toHaveLength(0);
    expect(followUpsOf(c.b.id)).toHaveLength(1);
    expect(out.sent[0].text).toContain("⚠️ Nomor 1 bukan customer Anda lagi.");
  });

  it("keeps what follows the reason as a comment from the salesman", async () => {
    const { customers: c, deps } = await reminded();
    await handleWahaEvent(message("2 kalah harga, pesaing lebih murah"), deps);

    const comments = db.select().from(recordComments).all();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ entityType: "customer", entityId: c.b.id, body: "pesaing lebih murah", authorName: "Andi" });
  });

  it("works for a salesman without a login: recorded, attributed to no one, the note dropped", async () => {
    const { salesmanB, admin } = await seedOrg();
    setWhatsappNumber(salesmanB.id, "628333333333");
    const x = addCustomer({ salesmanId: salesmanB.id, nama: "Toko Tanpa Login", lastOrderDate: "2026-03-24" });
    const wa = fakeClient();
    await triggerBatch({ triggeredById: admin.id, client: wa.client, today: TODAY });
    const out = fakeClient();

    const result = await handleWahaEvent(
      message("kalah harga, mahal", { from: "628333333333@c.us" }),
      { client: out.client, lookupLid: async () => null },
    );

    expect(result).toMatchObject({ outcome: "recorded" });
    expect(followUpsOf(x.id)).toHaveLength(1);
    expect(logsFor("customer", x.id)[0].actorName).toBe("");
    expect(db.select().from(recordComments).all()).toHaveLength(0);
  });
});

describe("which reminder a reply is about", () => {
  beforeEach(() => resetDb());

  it("the newest reminder that still has a customer waiting; a quoted message picks its own", async () => {
    const { admin, salesman } = await seedOrg();
    const wa = fakeClient();
    const first = addCustomer({ salesmanId: salesman.id, nama: "Pertama", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: wa.client, today: TODAY }); // wamid.1 → the salesman
    const second = addCustomer({ salesmanId: salesman.id, nama: "Kedua", lastOrderDate: "2026-04-06" });
    await triggerBatch({ triggeredById: admin.id, client: wa.client, today: TODAY }); // holds only "Kedua"
    const out = fakeClient();
    const deps: InboundDeps = { client: out.client, lookupLid: async () => null };

    // "1" is the newest message's number 1 …
    await handleWahaEvent(message("1 Kalah Harga"), deps);
    expect(followUpsOf(second.id)).toHaveLength(1);
    expect(followUpsOf(first.id)).toHaveLength(0);

    // … until the salesman quotes the first message.
    const firstMessageId = "wamid.1";
    await handleWahaEvent(message("1 Stok Masih Ada", { replyTo: { id: firstMessageId } }), deps);
    expect(followUpsOf(first.id)).toHaveLength(1);
  });

  it("a reminder that never reached the salesman cannot be answered", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: fakeClient({ fail: true }).client, today: TODAY });
    const out = fakeClient();

    const result = await handleWahaEvent(message("Kalah Harga"), { client: out.client, lookupLid: async () => null });

    expect(result).toMatchObject({ outcome: "nothing_pending", detail: "belum ada reminder terkirim" });
    expect(db.select().from(followUps).all()).toHaveLength(0);
    expect(out.sent[0].text).toContain("Tidak ada reminder");
  });

  it("the supervisor's summary is not something to answer: their own messages record nothing", async () => {
    const { deps, supervisor } = await reminded();
    void supervisor;
    await handleWahaEvent(message("Kalah Harga", { from: "628111111111@c.us" }), deps);
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });
});

describe("messages that are not answers", () => {
  beforeEach(() => resetDb());

  it("a number that is not a salesman's is kept but never answered", async () => {
    const { deps, out } = await reminded();
    const result = await handleWahaEvent(message("Kalah Harga", { from: "628999999999@c.us" }), deps);

    expect(result).toMatchObject({ outcome: "unknown_sender" });
    expect(out.sent).toHaveLength(0);
    expect(db.select().from(followUps).all()).toHaveLength(0);
    expect(db.select().from(inboundMessages).all()[0]).toMatchObject({ salesmanId: null, replyStatus: "none" });
  });

  it("text it does not understand gets the how-to reply — once an hour", async () => {
    const { deps, out } = await reminded();
    const at = (h: number, m = 0) => ({ ...deps, now: new Date(Date.UTC(2026, 7, 22, h, m)) });

    await handleWahaEvent(message("ok siap"), at(3));
    await handleWahaEvent(message("terima kasih"), at(3, 30)); // half an hour later: no second reply
    await handleWahaEvent(message("halo"), at(4, 1)); // more than an hour after the first

    expect(out.sent).toHaveLength(2);
    expect(out.sent[0].text).toContain('Balasan belum dikenali. Tekan Balas (reply) pada pesan reminder, lalu tulis nomor + alasan, mis. "3 Kalah Harga"');
    expect(out.sent[0].text).toContain("Pilihan alasan: Kalah Harga / Stok Masih Ada / Sudah Bangkrut; boleh juga alasan Anda sendiri.");
    const rows = db.select().from(inboundMessages).all();
    expect(rows.map((r) => [r.outcome, r.replyStatus])).toEqual([
      ["unrecognized", "sent"],
      ["unrecognized", "none"],
      ["unrecognized", "sent"],
    ]);
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });

  it("two different reasons without numbers are ambiguous, so nothing is recorded", async () => {
    const { deps } = await reminded();
    const result = await handleWahaEvent(message("Kalah Harga\nStok Masih Ada"), deps);
    expect(result).toMatchObject({ outcome: "unrecognized", detail: "beberapa alasan berbeda tanpa nomor" });
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });

  it("our own messages, groups, other sessions, other events and empty text are ignored", async () => {
    const { deps, out } = await reminded();
    const ignored = async (event: unknown) => (await handleWahaEvent(event, deps)).status;

    expect(await ignored(message("Kalah Harga", { fromMe: true }))).toBe("ignored");
    expect(await ignored(message("Kalah Harga", { from: "1203630@g.us" }))).toBe("ignored");
    expect(await ignored(message("Kalah Harga", {}, { session: "lain" }))).toBe("ignored");
    expect(await ignored(message("Kalah Harga", {}, { event: "message.ack" }))).toBe("ignored");
    expect(await ignored(message("   "))).toBe("ignored");
    expect(await ignored({ event: "message" })).toBe("ignored");
    expect(await ignored(null)).toBe("ignored");
    expect(out.sent).toHaveLength(0);
    expect(db.select().from(inboundMessages).all()).toHaveLength(0);
    expect(db.select().from(followUps).all()).toHaveLength(0);
  });

  it("an anonymous @lid sender is looked up; one that cannot be resolved is ignored", async () => {
    const { deps, customers: c } = await reminded();
    const resolved = { ...deps, lookupLid: async (lid: string) => (lid === "5551@lid" ? SALESMAN_WA : null) };

    expect(await handleWahaEvent(message("1 Kalah Harga", { from: "5551@lid" }), resolved)).toMatchObject({ status: "handled", outcome: "recorded" });
    expect(followUpsOf(c.a.id)).toHaveLength(1);

    expect(await handleWahaEvent(message("2 Kalah Harga", { from: "9999@lid" }), resolved)).toMatchObject({ status: "ignored" });
    expect(followUpsOf(c.b.id)).toHaveLength(0);
  });
});

const noteOf = (customerId: number) => followUpsOf(customerId)[0]?.note;

describe("answering in the salesman's own words", () => {
  beforeEach(() => resetDb());

  it("after a number, the words are the reason: recorded, shown in the activity, no change of status", async () => {
    const { customers: c, deps, out } = await reminded();

    const result = await handleWahaEvent(message("1. Barang masih ada"), deps);

    expect(result).toMatchObject({ status: "handled", outcome: "recorded" });
    expect(followUpsOf(c.a.id)).toHaveLength(1);
    expect(noteOf(c.a.id)).toBe("Barang masih ada");
    expect(pendingCustomerIds().has(c.a.id)).toBe(false);
    expect(statusOf(c.a.id)).toBe("aktif");
    expect(logsFor("customer", c.a.id)[0].changes).toEqual({ alasan_keterlambatan: { from: null, to: "Barang masih ada (via WhatsApp)" } });
    expect(out.sent[0].text).toContain("1. ES TELER — Barang masih ada");
  });

  it("is counted under 'Lainnya', and only the exact 'Sudah Bangkrut' deactivates", async () => {
    const { customers: c, deps } = await reminded();

    await handleWahaEvent(message("1 toko sudah bangkrut total"), deps); // free text, not the offered reason
    await handleWahaEvent(message("2 Sudah Bangkrut"), deps);

    expect(statusOf(c.a.id)).toBe("aktif");
    expect(statusOf(c.b.id)).toBe("inactive");
    const counts = Object.fromEntries(reasonCounts().map((r) => [r.code, r.count]));
    expect(counts).toMatchObject({ other: 1, "3": 1 });
  });

  it("without a number and without replying to the reminder it is only chatter", async () => {
    const { deps, out } = await reminded();

    const result = await handleWahaEvent(message("Barang masih ada"), deps);

    expect(result).toMatchObject({ outcome: "unrecognized" });
    expect(db.select().from(followUps).all()).toHaveLength(0);
    expect(out.sent[0].text).toContain("Tekan Balas (reply)");
  });

  it("a long answer is kept, cut at 500 characters, and cut shorter in the confirmation", async () => {
    const { customers: c, deps, out } = await reminded();
    const long = "sangat ".repeat(200).trim();

    await handleWahaEvent(message(`1 ${long}`), deps);

    expect(noteOf(c.a.id)!.length).toBe(500);
    expect(noteOf(c.a.id)!.endsWith("…")).toBe(true);
    expect(out.sent[0].text.split("\n")[1]).toHaveLength("1. ES TELER — ".length + 80);
  });
});

describe("replying to the reminder", () => {
  beforeEach(() => resetDb());
  /** The salesman's reminder was sent as WhatsApp message `wamid.1` (see `fakeClient`). */
  const reply = (body: string, over: Record<string, unknown> = {}) => message(body, { replyTo: { id: "wamid.1" }, ...over });

  it("free text without a number answers every customer of that reminder still waiting, and updates each one's activity", async () => {
    const { customers: c, deps, out, run } = await reminded();

    const result = await handleWahaEvent(reply("Barang masih ada, nanti dihubungi lagi"), deps);

    expect(result).toMatchObject({ outcome: "recorded" });
    for (const customer of [c.a, c.b, c.c]) {
      expect(followUpsOf(customer.id), customer.nama).toHaveLength(1);
      expect(logsFor("customer", customer.id)[0].changes).toEqual({
        alasan_keterlambatan: { from: null, to: "Barang masih ada, nanti dihubungi lagi (via WhatsApp)" },
      });
    }
    expect(pendingCustomerIds().size).toBe(0);
    const [row] = db.select().from(inboundMessages).all();
    expect(row.replyTo).toBe("wamid.1");
    expect(row.detail).toContain(`membalas pengiriman #${run.id}`);
    expect(out.sent[0].text).toContain("✅ Tercatat: 3 customer");
  });

  it("numbers still pick customers, and an offered reason is still recognised", async () => {
    const { customers: c, deps } = await reminded();

    await handleWahaEvent(reply("2 toko tutup sementara"), deps);
    await handleWahaEvent(reply("3 Kalah Harga"), deps);

    expect(followUpsOf(c.a.id)).toHaveLength(0);
    expect(noteOf(c.b.id)).toBe("toko tutup sementara");
    expect(logsFor("customer", c.c.id)[0].changes).toEqual({ alasan_keterlambatan: { from: null, to: "Kalah Harga (via WhatsApp)" } });
  });

  it("replying to an earlier reminder updates that reminder's customers, not the newest one's", async () => {
    const { admin, salesman } = await seedOrg();
    const wa = fakeClient();
    const older = addCustomer({ salesmanId: salesman.id, nama: "Lama", lastOrderDate: "2026-03-24" });
    await triggerBatch({ triggeredById: admin.id, client: wa.client, today: TODAY }); // wamid.1
    const newer = addCustomer({ salesmanId: salesman.id, nama: "Baru", lastOrderDate: "2026-04-06" });
    await triggerBatch({ triggeredById: admin.id, client: wa.client, today: TODAY });
    const out = fakeClient();
    const deps: InboundDeps = { client: out.client, lookupLid: async () => null };

    await handleWahaEvent(reply("Stok masih ada"), deps);

    expect(followUpsOf(older.id)).toHaveLength(1);
    expect(followUpsOf(newer.id)).toHaveLength(0);
  });

  it("quoting some other message is not replying to a reminder", async () => {
    const { deps, out } = await reminded();

    const result = await handleWahaEvent(message("Barang masih ada", { replyTo: { id: "pesan-lain" } }), deps);

    expect(result).toMatchObject({ outcome: "unrecognized" });
    expect(db.select().from(followUps).all()).toHaveLength(0);
    const [row] = db.select().from(inboundMessages).all();
    expect(row).toMatchObject({ replyTo: "pesan-lain" });
    expect(row.detail).toContain("mengutip pesan lain");
    expect(out.sent).toHaveLength(1);
  });

  it("customers already answered are left out of an 'everyone' reply", async () => {
    const { customers: c, deps } = await reminded();
    await handleWahaEvent(message("1 Kalah Harga"), deps);

    await handleWahaEvent(reply("Barang masih ada"), deps);

    expect(followUpsOf(c.a.id)).toHaveLength(1); // still just the first answer
    expect(followUpsOf(c.b.id)).toHaveLength(1);
    expect(followUpsOf(c.c.id)).toHaveLength(1);
    expect(noteOf(c.a.id)).toBe(""); // the offered reason had no words with it
  });
});

describe("what is kept of the messages that arrive", () => {
  beforeEach(() => resetDb());

  it("a stranger's text is never stored — only the number and that it was not a salesman", async () => {
    const { deps } = await reminded();
    await handleWahaEvent(message("Halo, saya mau pesan gula 50 kg", { from: "628999999999@c.us" }), deps);

    const [row] = db.select().from(inboundMessages).all();
    expect(row).toMatchObject({ outcome: "unknown_sender", fromAddress: "628999999999", body: "", salesmanId: null });
  });

  it("only the latest 200 messages from strangers are kept", async () => {
    const { deps } = await reminded();
    for (let i = 0; i < 205; i++) await handleWahaEvent(message("x", { from: `62800000${String(i).padStart(4, "0")}@c.us`, id: `orang-asing-${i}` }), deps);
    await handleWahaEvent(message("2 Kalah Harga"), deps); // a salesman's message, alongside

    const rows = db.select().from(inboundMessages).all();
    expect(rows.filter((r) => r.outcome === "unknown_sender")).toHaveLength(200);
    expect(rows.some((r) => r.providerMessageId === "orang-asing-0")).toBe(false); // the oldest went
    expect(rows.some((r) => r.providerMessageId === "orang-asing-204")).toBe(true);
    expect(rows.filter((r) => r.outcome === "recorded")).toHaveLength(1); // the salesman's stays
  });

  it("a salesman's messages are kept for 180 days, then go the next time anything arrives", async () => {
    const { deps } = await reminded();
    const day = 24 * 60 * 60 * 1000;
    const t0 = new Date("2026-08-22T03:00:00Z");
    await handleWahaEvent(message("ok siap", { id: "lama" }), { ...deps, now: t0 });
    await handleWahaEvent(message("halo", { id: "hampir-lama" }), { ...deps, now: new Date(t0.getTime() + 100 * day) });
    expect(db.select().from(inboundMessages).all()).toHaveLength(2);

    await handleWahaEvent(message("terima kasih", { id: "baru" }), { ...deps, now: new Date(t0.getTime() + 181 * day) });

    expect(db.select().from(inboundMessages).all().map((r) => r.providerMessageId).sort()).toEqual(["baru", "hampir-lama"]);
  });

  it("stores at most 2000 characters of a message", async () => {
    const { deps } = await reminded();
    await handleWahaEvent(message("1 " + "a".repeat(5000)), deps);
    expect(db.select().from(inboundMessages).all()[0].body).toHaveLength(2000);
  });
});

describe("the same message arriving twice (WAHA retries)", () => {
  beforeEach(() => resetDb());

  it("is recorded and answered once", async () => {
    const { customers: c, deps, out } = await reminded();
    const event = message("1 Kalah Harga");

    expect((await handleWahaEvent(event, deps)).status).toBe("handled");
    expect((await handleWahaEvent(event, deps)).status).toBe("duplicate");

    expect(followUpsOf(c.a.id)).toHaveLength(1);
    expect(out.sent).toHaveLength(1);
    expect(db.select().from(inboundMessages).all()).toHaveLength(1);
  });

  it("also when the first attempt is still in progress: the check and the write are one step", async () => {
    const { deps } = await reminded();
    const input = { providerMessageId: "same", session: "default", fromDigits: SALESMAN_WA, body: "1 Kalah Harga", receivedAt: "2026-08-22T00:00:00Z", now: deps.now };
    expect(receiveReply(input).duplicate).toBe(false);
    expect(receiveReply(input).duplicate).toBe(true);
  });

  it("a failed confirmation is recorded as failed, and the reason still counts", async () => {
    const { customers: c, deps } = await reminded();
    const broken = fakeClient({ fail: true });

    const result = await handleWahaEvent(message("1 Kalah Harga"), { ...deps, client: broken.client });

    expect(result).toMatchObject({ outcome: "recorded", replied: false });
    expect(followUpsOf(c.a.id)).toHaveLength(1);
    expect(db.select().from(inboundMessages).all()[0].replyStatus).toBe("failed");
  });
});

describe("composeConfirmation", () => {
  const rec = (n: number) => ({ position: n, nama: `TOKO ${n}`, reason: "Kalah Harga" });

  it("lists what was recorded and how many are still waiting", () => {
    expect(composeConfirmation({ recorded: [rec(1), rec(2)], warnings: [], remaining: 5 })).toBe(
      "✅ Tercatat: 2 customer\n1. TOKO 1 — Kalah Harga\n2. TOKO 2 — Kalah Harga\nSisa menunggu balasan: 5 customer.",
    );
  });

  it("cuts a long list so the message stays readable", () => {
    const text = composeConfirmation({ recorded: Array.from({ length: 42 }, (_, i) => rec(i + 1)), warnings: [], remaining: 0 });
    expect(text.split("\n")).toHaveLength(1 + 10 + 1 + 1);
    expect(text).toContain("…dan 32 lainnya");
    expect(text).toContain("Semua customer di reminder ini sudah dijawab.");
  });
});
