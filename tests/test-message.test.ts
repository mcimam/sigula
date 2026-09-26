import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { notificationDeliveries, notificationRuns, permissions, rolePermissions, roles, salesmen } from "~/db/schema";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { pendingCustomerIds } from "~/lib/pending.server";
import { resendReminder, sendTestMessage, TEST_MESSAGE_COOLDOWN_SECONDS } from "~/lib/reminders.server";
import { saveWahaSettings } from "~/lib/settings.server";
import type { WahaClient } from "~/lib/waha.server";
import { action } from "~/routes/admin.masterdata";

import { addCustomer, createUser, logsFor, requestAs, resetDb, seedOrg } from "./helpers/fixtures";

/** A WAHA client that records what it is asked to send. */
function fakeClient(opts?: { fail?: string }) {
  const sent: { to: string; text: string }[] = [];
  const client: WahaClient = {
    async sendText(to, text) {
      sent.push({ to, text });
      return opts?.fail ? { ok: false, errorMessage: opts.fail } : { ok: true, messageId: `wamid.${sent.length}` };
    },
  };
  return { client, sent };
}

describe("sendTestMessage — one short message to a salesman's WhatsApp number", () => {
  beforeEach(() => resetDb());

  it("sends a message that is plainly a test, to that salesman only — and records it on the salesman", async () => {
    const { admin, salesman } = await seedOrg();
    const { client, sent } = fakeClient();

    const result = await sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client });

    expect(result).toEqual({ salesmanName: "Andi Sales", number: "628222222222" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("628222222222");
    expect(sent[0].text).toContain("Pesan tes SiGula");
    expect(sent[0].text).toContain("Halo Andi Sales");
    expect(sent[0].text).not.toContain("Reminder Customer"); // never mistaken for a reminder
    const [entry] = logsFor("salesman", salesman.id);
    expect(entry.action).toBe("update");
    expect(entry.changes).toEqual({ pesan_tes_dikirim: { from: null, to: "628222222222 (WhatsApp)" } });
    expect(entry.actorName).toBe("Admin");
  });

  it("is not a reminder: no run, no delivery, nobody becomes pending", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "ES TELER", lastOrderDate: "2026-03-24" });

    await sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client: fakeClient().client });

    expect(db.select().from(notificationRuns).all()).toHaveLength(0);
    expect(db.select().from(notificationDeliveries).all()).toHaveLength(0);
    expect(pendingCustomerIds().has(c.id)).toBe(false);
  });

  it("hands the number over as saved; making it 62… is the WAHA client's job", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "0812-2222-2222");
    const { client, sent } = fakeClient();

    await sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("0812-2222-2222");
  });

  it("a message WhatsApp refused is an error carrying WhatsApp's reason — and is not recorded as sent", async () => {
    const { admin, salesman } = await seedOrg();
    const { client } = fakeClient({ fail: "WhatsApp menolak pesan ini: akun pengirim sedang dibatasi WhatsApp" });

    await expect(sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client })).rejects.toThrow(
      "Pesan tes gagal dikirim ke Andi Sales: WhatsApp menolak pesan ini: akun pengirim sedang dibatasi WhatsApp",
    );

    expect(logsFor("salesman", salesman.id)).toHaveLength(0);
  });

  it("a failed test can be tried again at once (the cooldown is for sent ones)", async () => {
    const { admin, salesman } = await seedOrg();
    await expect(sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client: fakeClient({ fail: "down" }).client })).rejects.toThrow("down");

    const again = fakeClient();
    await sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client: again.client });

    expect(again.sent).toHaveLength(1);
  });

  it("is refused, before anything is sent, for a salesman that is unknown, deleted or has no usable number", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const { client, sent } = fakeClient();
    const send = (salesmanId: number) => sendTestMessage({ salesmanId, sentById: admin.id, client });

    await expect(send(9999)).rejects.toThrow("Salesman tidak ditemukan");

    setWhatsappNumber(salesman.id, "");
    await expect(send(salesman.id)).rejects.toThrow("Andi Sales belum punya nomor WhatsApp");

    setWhatsappNumber(salesmanB.id, "abc 12");
    await expect(send(salesmanB.id)).rejects.toThrow("Nomor WhatsApp Citra Sales tidak valid (abc 12)");

    db.update(salesmen).set({ deletedAt: "2026-09-01T00:00:00.000Z" }).where(eq(salesmen.id, salesmanB.id)).run();
    await expect(send(salesmanB.id)).rejects.toThrow("Salesman tidak ditemukan");

    expect(sent).toHaveLength(0);
  });

  it("does not send twice in a row to the same salesman, but does to another one and again after the cooldown", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const { client, sent } = fakeClient();
    const now = new Date();

    await sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client, now });
    await expect(sendTestMessage({ salesmanId: salesman.id, sentById: admin.id, client, now })).rejects.toThrow(
      `Pesan tes baru saja dikirim ke Andi Sales — tunggu ${TEST_MESSAGE_COOLDOWN_SECONDS} detik`,
    );
    await sendTestMessage({ salesmanId: salesmanB.id, sentById: admin.id, client, now });
    await sendTestMessage({
      salesmanId: salesman.id,
      sentById: admin.id,
      client,
      now: new Date(now.getTime() + (TEST_MESSAGE_COOLDOWN_SECONDS + 1) * 1000),
    });

    expect(sent.map((s) => s.to)).toEqual(["628222222222", "628333333333", "628222222222"]);
  });
});

describe("WhatsApp refuses what WAHA accepted (the production incident: 201, then ack -1)", () => {
  beforeEach(() => {
    resetDb();
    saveWahaSettings({ baseUrl: "http://waha.test", session: "default", timeoutMs: 3000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** WAHA takes every message (201) and WhatsApp then refuses it (ack -1) — the account is restricted. */
  const stubRefusingWaha = () => {
    const sends: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/sendText") {
        sends.push(String(init?.body));
        return Response.json({ id: "true_628222222222@c.us_ABC" }, { status: 201 });
      }
      if (path.includes("/chats/")) return Response.json({ ack: -1, ackName: "ERROR" });
      if (path === "/api/sessions/default") {
        return Response.json({ name: "default", me: { reachoutTimelock: { isActive: true, timeEnforcementEnds: Date.now() / 1000 + 3600 } } });
      }
      return new Response("{}", { status: 404 });
    });
    return sends;
  };

  it("a reminder sent again is reported as failed, its run is voided and the customer is not left 'pending'", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "ES TELER", lastOrderDate: "2026-03-24" });
    stubRefusingWaha();

    await expect(resendReminder({ customerId: c.id, triggeredById: admin.id, today: "2026-08-22" })).rejects.toThrow(
      /Pengingat gagal dikirim ke Andi Sales: WhatsApp menolak pesan ini: akun pengirim sedang dibatasi/,
    );

    const [delivery] = db.select().from(notificationDeliveries).all();
    expect(delivery.status).toBe("failed");
    expect(delivery.sentAt).toBeNull();
    expect(delivery.errorMessage).toContain("reachout timelock");
    expect(db.select().from(notificationRuns).all()[0].voidedAt).not.toBeNull();
    expect(pendingCustomerIds().has(c.id)).toBe(false);
    expect(logsFor("customer", c.id)).toHaveLength(0); // no "pengingat dikirim" for a message that never left
  });
});

describe("the menu action on a salesman in Data Master", () => {
  beforeEach(() => {
    resetDb();
    saveWahaSettings({ baseUrl: "http://waha.test", session: "default", timeoutMs: 3000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** `ack` is what WhatsApp says about every message; the sends are recorded. */
  const stubWaha = (ack: number) => {
    const sends: { chatId: string; text: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/sendText") {
        sends.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "true_628222222222@c.us_TEST" }, { status: 201 });
      }
      if (path.includes("/chats/")) return Response.json({ ack });
      return new Response("{}", { status: 404 });
    });
    return sends;
  };
  const post = async (userId: number, fields: Record<string, string>) => {
    const cookie = (await requestAs(userId)).headers.get("Cookie")!;
    return action({
      request: new Request("http://localhost/admin/masterdata", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }),
    } as never);
  };
  const flashOf = (res: unknown) => {
    const url = new URL((res as Response).headers.get("Location")!);
    return { edit: url.searchParams.get("edit"), tab: url.searchParams.get("tab"), flash: url.searchParams.get("flash") };
  };

  it("an admin sends it, and lands back on the same salesman's panel with the result", async () => {
    const { admin, salesman } = await seedOrg();
    const sends = stubWaha(2);

    const res = await post(admin.id, { intent: "send_test_message", salesman_id: String(salesman.id) });

    expect(flashOf(res)).toEqual({ edit: String(salesman.id), tab: "salesman", flash: "Pesan tes dikirim ke Andi Sales" });
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe("628222222222@c.us");
    expect(sends[0].text).toContain("Pesan tes SiGula");
    expect(logsFor("salesman", salesman.id)).toHaveLength(1);
  });

  it("when WhatsApp refuses it, the panel shows why and nothing is recorded as sent", async () => {
    const { admin, salesman } = await seedOrg();
    stubWaha(-1);

    const res = await post(admin.id, { intent: "send_test_message", salesman_id: String(salesman.id) });

    const { flash, edit, tab } = flashOf(res);
    expect([edit, tab]).toEqual([String(salesman.id), "salesman"]);
    expect(flash).toContain("Pesan tes gagal dikirim ke Andi Sales: WhatsApp menolak pesan ini");
    expect(logsFor("salesman", salesman.id)).toHaveLength(0);
  });

  it("a salesman without a number comes back as a message, and nothing is sent", async () => {
    const { admin, salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "");
    const sends = stubWaha(2);

    const res = await post(admin.id, { intent: "send_test_message", salesman_id: String(salesman.id) });

    expect(flashOf(res).flash).toBe("Andi Sales belum punya nomor WhatsApp");
    expect(sends).toHaveLength(0);
  });

  it("someone who may edit master data but not send notifications gets a 403 and nothing is sent; so does a salesman", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const sends = stubWaha(2);
    const perm = db.select().from(permissions).where(eq(permissions.code, "masterdata.manage")).get()!;
    const role = db.insert(roles).values({ code: "hanya-master", name: "Hanya master data" }).returning().get();
    try {
      db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id, scope: "all" }).run();
      const editor = createUser("editor", "Editor", ["hanya-master"]);

      for (const who of [editor.id, salesmanUser.id]) {
        const status = await post(who, { intent: "send_test_message", salesman_id: String(salesman.id) }).then(
          () => "returned",
          (e) => (e instanceof Response ? e.status : String(e)),
        );
        expect(status, String(who)).toBe(403);
      }
      expect(sends).toHaveLength(0);
      expect(logsFor("salesman", salesman.id)).toHaveLength(0);
    } finally {
      db.delete(roles).where(eq(roles.id, role.id)).run(); // reference data: leave it as it was
    }
  });
});
