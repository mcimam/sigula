import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveWahaSettings } from "~/lib/settings.server";
import { createWahaClient, getWahaSessionView } from "~/lib/waha.server";

import { resetDb } from "./helpers/fixtures";

/**
 * WAHA answers `sendText` with 201 before WhatsApp has accepted the message; WhatsApp's verdict is
 * the message's `ack` (-1 error, 0 pending, 1 server, 2 device, 3 read). The production incident:
 * a restricted account got 201 for every reminder, and every reminder was recorded as sent.
 */

const SESSION = "Sigula";
const MESSAGE_ID = "true_628128888021@c.us_3EB0AAAA";
/** 2026-09-27 06:00:48 WIB, as WAHA reports it (seconds since the epoch). */
const LOCK_ENDS_S = Date.parse("2026-09-26T23:00:48Z") / 1000;
const NOW = new Date("2026-09-26T17:00:00Z");

type Reply = { status?: number; body?: unknown } | Error;
type Call = { method: string; path: string };

/** A WAHA whose answers are chosen per path; anything not handled is a 404. */
function stubWaha(handler: (call: Call) => Reply | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const call = { method: init?.method ?? "GET", path: url.pathname + url.search };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, body: { message: "no route" } };
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body ?? null), { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

const isSend = (c: Call) => c.method === "POST" && c.path === "/api/sendText";
const isAckLookup = (c: Call) => c.method === "GET" && c.path.includes("/chats/");
const lockRecord = (over?: Record<string, unknown>) => ({
  name: SESSION,
  status: "WORKING",
  me: {
    id: "62811@c.us",
    pushName: "Sigula",
    reachoutTimelock: { enforcementType: "RESTRICT_ALL_COMPANIONS", isActive: true, timeEnforcementEnds: LOCK_ENDS_S, ...over },
  },
});

/** A WAHA that accepts the message (201) and then reports `acks` one lookup at a time (the last one repeats). */
function wahaWithAcks(acks: number[], session: unknown = lockRecord()) {
  let looked = 0;
  return stubWaha((c) => {
    if (isSend(c)) return { status: 201, body: { id: MESSAGE_ID } };
    if (isAckLookup(c)) return { body: { id: MESSAGE_ID, ack: acks[Math.min(looked++, acks.length - 1)] } };
    if (c.method === "GET" && c.path === `/api/sessions/${SESSION}`) return { body: session };
    return undefined;
  });
}

beforeEach(() => {
  resetDb();
  saveWahaSettings({ baseUrl: "http://waha.test", session: SESSION, timeoutMs: 3000 });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs a send to completion under fake timers (the client sleeps between two looks at the ack). */
async function send(opts?: { ackWaitMs?: number }) {
  const pending = createWahaClient(opts).sendText("08128888021", "halo");
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

describe("WahaClient.sendText — asks WhatsApp's verdict, not just WAHA's", () => {
  it.each([1, 2, 3])("ack %i (WhatsApp took it): sent, after one look", async (ack) => {
    const calls = wahaWithAcks([ack]);

    const result = await send();

    expect(result).toEqual({ ok: true, messageId: MESSAGE_ID });
    expect(calls.filter(isAckLookup)).toHaveLength(1);
  });

  it("looks the message up under the chat in its id (an @lid chat, not the @c.us it was addressed to), URL-encoded", async () => {
    const calls = stubWaha((c) => {
      if (isSend(c)) return { status: 201, body: { id: "true_1234567890123@lid_3EB0BBBB" } };
      if (isAckLookup(c)) return { body: { ack: 2 } };
      return undefined;
    });

    await send();

    expect(calls.find(isAckLookup)?.path).toBe(
      `/api/${SESSION}/chats/1234567890123%40lid/messages/true_1234567890123%40lid_3EB0BBBB`,
    );
  });

  it("ack -1 while the account is under a reachout timelock: failed, saying why and until when", async () => {
    wahaWithAcks([-1]);

    const result = await send();

    expect(result.ok).toBe(false);
    expect(result.messageId).toBe(MESSAGE_ID);
    expect(result.errorMessage).toContain("akun pengirim sedang dibatasi WhatsApp");
    expect(result.errorMessage).toContain("sampai 27 Sep 2026, 06.00 WIB");
    expect(result.errorMessage).toContain("Minta penerima mengirim satu pesan ke nomor SiGula");
  });

  it("ack -1 with no restriction on the account: failed, with the general reason", async () => {
    wahaWithAcks([-1], { name: SESSION, status: "WORKING", me: { id: "62811@c.us" } });

    const result = await send();

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("WhatsApp menolak pesan ini (status ERROR)");
    expect(result.errorMessage).not.toContain("reachout");
  });

  it("a restriction that already ended is not blamed", async () => {
    wahaWithAcks([-1], lockRecord({ timeEnforcementEnds: NOW.getTime() / 1000 - 60 }));

    const result = await send();

    expect(result.errorMessage).toContain("WhatsApp menolak pesan ini (status ERROR)");
  });

  it("still pending: waits for the verdict, and reports a refusal that arrives in time", async () => {
    const calls = wahaWithAcks([0, 0, -1]);

    const result = await send();

    expect(result.ok).toBe(false);
    expect(calls.filter(isAckLookup)).toHaveLength(3);
  });

  it("still pending when the wait is over: in doubt it is sent (never failed on a guess)", async () => {
    const calls = wahaWithAcks([0]);

    const result = await send({ ackWaitMs: 1500 });

    expect(result).toEqual({ ok: true, messageId: MESSAGE_ID });
    expect(calls.filter(isAckLookup).length).toBeGreaterThan(1);
    expect(calls.filter(isAckLookup).length).toBeLessThanOrEqual(4);
  });

  it("ackWaitMs 0 looks exactly once", async () => {
    const calls = wahaWithAcks([0]);

    await send({ ackWaitMs: 0 });

    expect(calls.filter(isAckLookup)).toHaveLength(1);
  });

  it.each([
    ["the lookup 404s (the message is not in WAHA's history)", { status: 404, body: { message: "not found" } }],
    ["the lookup fails", { status: 500, body: null }],
    ["the lookup does not know an ack", { body: { id: MESSAGE_ID } }],
    ["WAHA is unreachable for the lookup", new Error("ECONNRESET")],
  ] as [string, Reply][])("when %s: sent, not failed", async (_why, reply) => {
    stubWaha((c) => {
      if (isSend(c)) return { status: 201, body: { id: MESSAGE_ID } };
      if (isAckLookup(c)) return reply;
      return undefined;
    });

    expect(await send()).toEqual({ ok: true, messageId: MESSAGE_ID });
  });

  it("no message id in the answer: nothing to look up, sent", async () => {
    const calls = stubWaha((c) => (isSend(c) ? { status: 201, body: {} } : undefined));

    expect(await send()).toEqual({ ok: true, messageId: undefined });
    expect(calls).toHaveLength(1);
  });

  it("a refused send (not 2xx) is failed without any lookup", async () => {
    const calls = stubWaha((c) => (isSend(c) ? { status: 500, body: { message: "boom" } } : undefined));

    const result = await send();

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("getWahaSessionView — the restriction on the linked account", () => {
  const list = (record: unknown, session?: (c: Call) => Reply | undefined) =>
    stubWaha((c) => {
      if (c.path === "/api/sessions?all=true") return { body: [record] };
      return session?.(c);
    });

  it("shows it when the session list carries it (and asks nothing more)", async () => {
    const calls = list(lockRecord());

    const view = await getWahaSessionView();

    expect(view.state).toBe("WORKING");
    expect(view.restriction).toEqual({ until: "2026-09-26T23:00:48.000Z" });
    expect(calls).toHaveLength(1);
  });

  it("asks the session's own record when the list leaves it out", async () => {
    const calls = list({ name: SESSION, status: "WORKING", me: { id: "62811@c.us" } }, (c) =>
      c.path === `/api/sessions/${SESSION}` ? { body: lockRecord() } : undefined,
    );

    const view = await getWahaSessionView();

    expect(view.restriction).toEqual({ until: "2026-09-26T23:00:48.000Z" });
    expect(calls.map((c) => c.path)).toEqual(["/api/sessions?all=true", `/api/sessions/${SESSION}`]);
  });

  it("is null for a healthy account, an ended restriction and a session record that cannot be read", async () => {
    list({ name: SESSION, status: "WORKING", me: { id: "62811@c.us", reachoutTimelock: { isActive: false } } });
    expect((await getWahaSessionView()).restriction).toBeNull();

    list(lockRecord({ timeEnforcementEnds: NOW.getTime() / 1000 - 1 }));
    expect((await getWahaSessionView()).restriction).toBeNull();

    list({ name: SESSION, status: "WORKING", me: { id: "62811@c.us" } });
    expect((await getWahaSessionView()).restriction).toBeNull(); // the second look 404s
  });

  it("says a restriction is on even when WhatsApp gave no end time", async () => {
    list(lockRecord({ timeEnforcementEnds: undefined }));

    expect((await getWahaSessionView()).restriction).toEqual({ until: null });
  });

  it("is null, without a second call, for a session that is not working", async () => {
    const calls = list({ name: SESSION, status: "STOPPED", me: null });

    const view = await getWahaSessionView();

    expect(view.restriction).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
