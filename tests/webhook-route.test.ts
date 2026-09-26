import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "~/db/client.server";
import { followUps, inboundMessages } from "~/db/schema";
import { saveWahaSettings } from "~/lib/settings.server";
import { triggerBatch } from "~/lib/reminders.server";
import { action } from "~/routes/webhooks.waha";
import type { WahaClient } from "~/lib/waha.server";

import { addCustomer, resetDb, seedOrg } from "./helpers/fixtures";

const SECRET = "kunci-bersama";

/** What WAHA would POST: the JSON, and its HMAC-SHA512 (hex) under `key`. */
function call(event: unknown, opts: { key?: string | null; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(event);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.key !== null) headers["X-Webhook-Hmac"] = crypto.createHmac("sha512", opts.key ?? SECRET).update(raw).digest("hex");
  return action({ request: new Request("http://localhost/webhooks/waha", { method: "POST", headers, body: raw }) } as never);
}
/** The status of the Response the route threw, or "returned". */
async function refusedWith(promise: Promise<unknown>) {
  try {
    await promise;
    return "returned";
  } catch (e) {
    return e instanceof Response ? e.status : `error: ${String(e)}`;
  }
}
const message = (body: string, from = "628222222222@c.us") => ({
  event: "message",
  session: "default",
  payload: { id: `false_${from}_${body}`, from, fromMe: false, body, timestamp: 1790000000 },
});

describe("POST /webhooks/waha", () => {
  beforeEach(() => resetDb());

  describe("with no secret (the signature is optional)", () => {
    it("takes an unsigned call — which is what WAHA sends when no HMAC key is configured", async () => {
      expect(await call(message("Kalah Harga", "628999999999@c.us"), { key: null })).toMatchObject({ status: "handled", outcome: "unknown_sender" });
      expect(await call({ event: "session.status", session: "default", payload: {} }, { key: null })).toMatchObject({ status: "ignored" });
    });

    it("does not look at a signature it has no key to check", async () => {
      expect(await call(message("Kalah Harga", "628999999999@c.us"), { key: "apa-saja" })).toMatchObject({ status: "handled" });
    });

    it("still refuses what is not JSON, and still records nothing for a stranger's reply", async () => {
      expect(await refusedWith(call(null, { raw: "bukan json", key: null }))).toBe(400);
      const { salesman, admin } = await seedOrg();
      addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
      await triggerBatch({ triggeredById: admin.id, client: { sendText: async () => ({ ok: true, messageId: "wamid.1" }) }, today: "2026-08-22" });
      await call(message("1 Kalah Harga", "628999999999@c.us"), { key: null }); // not the salesman's number
      expect(db.select().from(followUps).all()).toHaveLength(0);
    });
  });

  describe("size", () => {
    it("refuses a body over 1 MB, whether the header says so or only the body does", async () => {
      const big = JSON.stringify({ event: "message", payload: { body: "x".repeat(1_100_000) } });
      expect(await refusedWith(call(null, { raw: big, key: null }))).toBe(413);

      const request = new Request("http://localhost/webhooks/waha", { method: "POST", headers: { "content-length": "5000000" }, body: "{}" });
      expect(await refusedWith(action({ request } as never))).toBe(413);
    });
  });

  describe("with a secret", () => {
    beforeEach(() => saveWahaSettings({ baseUrl: "", session: "default", timeoutMs: 5000, webhookSecret: SECRET }));

    it("refuses a call that is not signed, or signed with another key", async () => {
      expect(await refusedWith(call(message("Kalah Harga"), { key: null }))).toBe(401);
      expect(await refusedWith(call(message("Kalah Harga"), { key: "lain" }))).toBe(401);
      expect(db.select().from(inboundMessages).all()).toHaveLength(0);
    });

    it("refuses a body that was changed after it was signed", async () => {
      const signedFor = JSON.stringify(message("Kalah Harga"));
      const request = new Request("http://localhost/webhooks/waha", {
        method: "POST",
        headers: { "X-Webhook-Hmac": crypto.createHmac("sha512", SECRET).update(signedFor).digest("hex") },
        body: JSON.stringify(message("Sudah Bangkrut")),
      });
      expect(await refusedWith(action({ request } as never))).toBe(401);
    });

    it("a signed body that is not JSON is a 400", async () => {
      expect(await refusedWith(call(null, { raw: "bukan json" }))).toBe(400);
    });

    it("answers 200 for a message that is not ours to act on, so WAHA does not retry it", async () => {
      const unknown = (await call(message("Kalah Harga", "628999999999@c.us"))) as { status: string; outcome: string };
      expect(unknown).toMatchObject({ status: "handled", outcome: "unknown_sender" });
      expect(await call({ event: "session.status", session: "default", payload: {} })).toMatchObject({ status: "ignored" });
    });

    it("records a reply end to end (the confirmation cannot be sent here: no WAHA is configured)", async () => {
      const { admin, salesman } = await seedOrg();
      const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-03-24" });
      const client: WahaClient = { sendText: async () => ({ ok: true, messageId: "wamid.1" }) };
      await triggerBatch({ triggeredById: admin.id, client, today: "2026-08-22" });

      const result = (await call(message("1 Kalah Harga"))) as { outcome: string; replied: boolean };

      expect(result).toMatchObject({ outcome: "recorded", replied: false });
      expect(db.select().from(followUps).all().map((f) => f.customerId)).toEqual([c.id]);
      expect(db.select().from(inboundMessages).all()[0]).toMatchObject({ outcome: "recorded", replyStatus: "failed" });
    });
  });
});
