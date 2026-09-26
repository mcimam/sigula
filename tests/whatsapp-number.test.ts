import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveWahaSettings } from "~/lib/settings.server";
import { createWahaClient } from "~/lib/waha.server";
import { isPlausibleWhatsappNumber, normalizeWhatsappNumber } from "~/lib/whatsapp-number";

import { resetDb } from "./helpers/fixtures";

describe("normalizeWhatsappNumber", () => {
  it("turns the way people write a local number into the one WhatsApp needs", () => {
    for (const typed of ["0812-3456-7890", "0812 3456 7890", "(0812) 34567890", "081234567890", "  081234567890  "]) {
      expect(normalizeWhatsappNumber(typed), typed).toBe("6281234567890");
    }
  });

  it("leaves a number that already has its country code alone, whatever is around it", () => {
    for (const typed of ["6281234567890", "+62 812-3456-7890", "+6281234567890", "62 812 3456 7890"]) {
      expect(normalizeWhatsappNumber(typed), typed).toBe("6281234567890");
    }
  });

  it("reads the international dialling prefix", () => {
    expect(normalizeWhatsappNumber("0062 812 3456 7890")).toBe("6281234567890");
  });

  it("gives an Indonesian mobile number typed without its 0 its country code", () => {
    expect(normalizeWhatsappNumber("81234567890")).toBe("6281234567890");
    expect(normalizeWhatsappNumber("812-3456-7890")).toBe("6281234567890");
  });

  it("does not touch a foreign number typed with a plus, or one too long to be an Indonesian mobile without a 0", () => {
    expect(normalizeWhatsappNumber("+86 138 0013 8000")).toBe("8613800138000");
    expect(normalizeWhatsappNumber("8613800138000")).toBe("8613800138000"); // 13 digits
    expect(normalizeWhatsappNumber("+1 (208) 608-8319")).toBe("12086088319");
  });

  it("is empty for nothing", () => {
    expect(normalizeWhatsappNumber("")).toBe("");
    expect(normalizeWhatsappNumber(" - ")).toBe("");
  });
});

describe("isPlausibleWhatsappNumber", () => {
  it("accepts 8 to 15 digits and nothing else", () => {
    expect(isPlausibleWhatsappNumber("6281234")).toBe(false); // 7
    expect(isPlausibleWhatsappNumber("62812345")).toBe(true); // 8: the floor
    expect(isPlausibleWhatsappNumber("6281234567890")).toBe(true);
    expect(isPlausibleWhatsappNumber("628123456789012")).toBe(true); // 15
    expect(isPlausibleWhatsappNumber("6281234567890123")).toBe(false); // 16
    expect(isPlausibleWhatsappNumber("")).toBe(false);
    expect(isPlausibleWhatsappNumber("62 812")).toBe(false);
    expect(isPlausibleWhatsappNumber("abc")).toBe(false);
  });
});

describe("WahaClient.sendText", () => {
  beforeEach(() => {
    resetDb();
    saveWahaSettings({ baseUrl: "http://waha.test", session: "Sigula", timeoutMs: 3000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const stub = (respond: () => Response) => {
    const bodies: { chatId: string; session: string; text: string }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: { body?: string }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return respond();
    });
    return bodies;
  };
  const ok = () => new Response(JSON.stringify({ id: "true_x@c.us_ABC" }), { status: 201 });

  it("addresses the chat with the country code, however the number was saved (the production 500)", async () => {
    const sent = stub(ok);
    for (const saved of ["08128888021", "0812-8888-021", "+62 812 8888 021", "628128888021", "8128888021"]) {
      const result = await createWahaClient().sendText(saved, "halo");
      expect(result.ok, saved).toBe(true);
    }
    expect(sent.map((b) => b.chatId)).toEqual(Array(5).fill("628128888021@c.us"));
    expect(sent[0]).toMatchObject({ session: "Sigula", text: "halo" });
  });

  it("keeps what WAHA said when it refuses, on one line, cut short", async () => {
    stub(() => new Response('{"statusCode":500,\n "exception":{"message":"t"}}', { status: 500, statusText: "Internal Server Error" }));
    const failed = await createWahaClient().sendText("628128888021", "halo");
    expect(failed).toEqual({ ok: false, errorMessage: 'WAHA returned 500: Internal Server Error — {"statusCode":500, "exception":{"message":"t"}}' });

    stub(() => new Response("x".repeat(1000), { status: 502, statusText: "Bad Gateway" }));
    const long = await createWahaClient().sendText("628128888021", "halo");
    expect(long.errorMessage).toBe(`WAHA returned 502: Bad Gateway — ${"x".repeat(160)}`);
  });

  it("says just the status when WAHA sent no explanation", async () => {
    stub(() => new Response("", { status: 500, statusText: "Internal Server Error" }));
    expect((await createWahaClient().sendText("628128888021", "halo")).errorMessage).toBe("WAHA returned 500: Internal Server Error");
  });
});
