import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveWahaSettings } from "~/lib/settings.server";
import {
  getWahaSessionView,
  loginWahaSession,
  logoutWahaSession,
} from "~/lib/waha.server";
import {
  WAHA_SESSION_STATUSES,
  canLogin,
  canLogout,
  describeSessionState,
  type WahaSessionState,
} from "~/lib/waha-session";

import { resetDb } from "./helpers/fixtures";

const SESSION = "Sigula";
const API_KEY = "secret-key-do-not-leak";
const LIST = "/api/sessions?all=true";
const QR_IMAGE = { mimetype: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" };
const ME = { id: "6281234567890@c.us", pushName: "Toko Gula" };

type Call = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};
type Reply = { status?: number; body?: unknown } | Error;

/** Replace global fetch; `handler` answers per call, anything it ignores is a 404. */
function stubWaha(handler: (call: Call) => Reply | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const call: Call = {
        method: init?.method ?? "GET",
        path: url.pathname + url.search,
        headers: { ...(init?.headers as Record<string, string>) },
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const reply = handler(call) ?? {
        status: 404,
        body: { message: "no route" },
      };
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body ?? null), {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

/**
 * A WAHA that remembers its session status: `null` = the session does not exist
 * (only an unrelated one does). `override` lets a test break one endpoint.
 */
function fakeWaha(
  initial: string | null,
  override?: (call: Call) => Reply | undefined,
) {
  let status = initial;
  const seg = `/api/sessions/${SESSION}`;
  const calls = stubWaha((call) => {
    const forced = override?.(call);
    if (forced) return forced;
    if (call.method === "GET" && call.path === LIST) {
      return {
        body:
          status === null
            ? [{ name: "other", status: "WORKING", me: ME }]
            : [{ name: SESSION, status, me: status === "WORKING" ? ME : null }],
      };
    }
    if (call.method === "GET" && call.path === `/api/${SESSION}/auth/qr`) {
      return { body: QR_IMAGE };
    }
    if (call.method === "POST" && call.path === "/api/sessions") {
      status = "STARTING";
      return { status: 201, body: {} };
    }
    if (call.method === "POST" && call.path === `${seg}/start`) {
      status = "STARTING";
      return { status: 201, body: {} };
    }
    if (call.method === "POST" && call.path === `${seg}/restart`) {
      status = "STARTING";
      return { status: 201, body: {} };
    }
    if (call.method === "POST" && call.path === `${seg}/logout`) {
      status = "STOPPED";
      return { status: 201, body: {} };
    }
    return undefined;
  });
  return calls;
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  resetDb();
  saveWahaSettings({
    baseUrl: "http://waha.test",
    session: SESSION,
    apiKey: API_KEY,
    timeoutMs: 5000,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getWahaSessionView", () => {
  it("reports unconfigured without calling WAHA when there is no base URL", async () => {
    vi.stubEnv("WAHA_BASE_URL", "");
    resetDb();
    const calls = stubWaha(() => undefined);

    const view = await getWahaSessionView();

    expect(view.state).toBe("unconfigured");
    expect(calls).toHaveLength(0);
  });

  it("reports error when WAHA is unreachable", async () => {
    stubWaha(() => new Error("connect ECONNREFUSED"));

    const view = await getWahaSessionView();

    expect(view.state).toBe("error");
    expect(view.message).toContain("tidak terjangkau");
  });

  it.each([401, 403])("reports rejected when the list answers %i", async (status) => {
    stubWaha(() => ({ status, body: { message: "Forbidden" } }));

    const view = await getWahaSessionView();

    expect(view.state).toBe("rejected");
    expect(view.message).toBe(`WAHA menjawab ${status}: Forbidden`);
  });

  it("reports error on a server failure and keeps only the JSON message", async () => {
    stubWaha(() => ({ status: 500, body: { message: ["boom", "again"] } }));

    const view = await getWahaSessionView();

    expect(view).toMatchObject({
      state: "error",
      message: "WAHA menjawab 500: boom; again",
    });
  });

  it("reports not_created when the list has no session of that name", async () => {
    fakeWaha(null);

    const view = await getWahaSessionView();

    expect(view).toMatchObject({ state: "not_created", session: SESSION });
    expect(view.account).toBeNull();
  });

  it("does not depend on GET /api/sessions/{name} (WAHA answers 403 for a missing session)", async () => {
    const calls = fakeWaha(null, (c) =>
      c.path === `/api/sessions/${SESSION}`
        ? { status: 403, body: { message: "Forbidden" } }
        : undefined,
    );

    const view = await getWahaSessionView();

    expect(view.state).toBe("not_created");
    expect(calls.map((c) => c.path)).toEqual([LIST]);
  });

  it("reads STOPPED without asking for a QR", async () => {
    const calls = fakeWaha("STOPPED");

    const view = await getWahaSessionView();

    expect(view.state).toBe("STOPPED");
    expect(view.qr).toBeNull();
    expect(calls.map((c) => c.path)).toEqual([LIST]);
  });

  it("returns the linked account while WORKING", async () => {
    fakeWaha("WORKING");

    const view = await getWahaSessionView();

    expect(view.state).toBe("WORKING");
    expect(view.account).toEqual({ name: "Toko Gula", number: "+6281234567890" });
    expect(view.qr).toBeNull();
  });

  it("fetches the QR (JSON, with the API key) while waiting for a scan", async () => {
    const calls = fakeWaha("SCAN_QR_CODE");

    const view = await getWahaSessionView();

    expect(view.state).toBe("SCAN_QR_CODE");
    expect(view.qr).toEqual(QR_IMAGE);
    const qrCall = calls.find((c) => c.path === `/api/${SESSION}/auth/qr`);
    expect(qrCall?.headers["X-Api-Key"]).toBe(API_KEY);
    expect(qrCall?.headers.Accept).toBe("application/json");
  });

  it("keeps SCAN_QR_CODE with no image while WAHA has not produced the QR yet", async () => {
    fakeWaha("SCAN_QR_CODE", (c) =>
      c.path === `/api/${SESSION}/auth/qr`
        ? { status: 404, body: { message: "QR not ready" } }
        : undefined,
    );

    const view = await getWahaSessionView();

    expect(view).toMatchObject({ state: "SCAN_QR_CODE", qr: null });
  });

  it.each([
    ["an SVG", { mimetype: "image/svg+xml", data: "PHN2Zz4=" }],
    ["a non-base64 payload", { mimetype: "image/png", data: 'x" onerror="y' }],
    ["an empty payload", { mimetype: "image/png", data: "" }],
    ["an oversized payload", { mimetype: "image/png", data: "A".repeat(200_001) }],
  ])("drops a QR that is %s", async (_label, qr) => {
    fakeWaha("SCAN_QR_CODE", (c) =>
      c.path === `/api/${SESSION}/auth/qr` ? { body: qr } : undefined,
    );

    const view = await getWahaSessionView();

    expect(view.qr).toBeNull();
  });

  it("maps a status this app does not know to UNKNOWN", async () => {
    fakeWaha("PASSKEY_REQUIRED");

    expect((await getWahaSessionView()).state).toBe("UNKNOWN");
  });

  it("url-encodes the session name and tolerates a trailing slash on the base URL", async () => {
    saveWahaSettings({
      baseUrl: "http://waha.test/",
      session: "My Session/1",
      timeoutMs: 5000,
    });
    const calls = stubWaha((c) =>
      c.path === LIST
        ? { body: [{ name: "My Session/1", status: "SCAN_QR_CODE" }] }
        : { body: QR_IMAGE },
    );

    await getWahaSessionView();

    expect(calls[1].path).toBe("/api/My%20Session%2F1/auth/qr");
  });

  it("never puts the API key in anything it returns (the result goes to the browser)", async () => {
    const outputs: unknown[] = [];
    for (const status of [null, "STOPPED", "SCAN_QR_CODE", "WORKING", "FAILED"]) {
      fakeWaha(status);
      outputs.push(await getWahaSessionView());
      outputs.push(await loginWahaSession());
      fakeWaha(status);
      outputs.push(await logoutWahaSession());
    }
    stubWaha(() => new Error("connect ECONNREFUSED"));
    outputs.push(await getWahaSessionView(), await loginWahaSession());
    stubWaha(() => ({ status: 403, body: { message: "Forbidden" } }));
    outputs.push(await getWahaSessionView(), await logoutWahaSession());

    expect(outputs.length).toBeGreaterThan(10);
    expect(JSON.stringify(outputs)).not.toContain(API_KEY);
  });
});

describe("loginWahaSession", () => {
  it("creates and starts the session when WAHA has none", async () => {
    const calls = fakeWaha(null);

    const result = await loginWahaSession();

    expect(posts(calls)).toEqual([
      expect.objectContaining({
        path: "/api/sessions",
        body: { name: SESSION, start: true },
      }),
    ]);
    expect(result.error).toBeNull();
    expect(result.view.state).toBe("STARTING");
  });

  it("starts a STOPPED session", async () => {
    const calls = fakeWaha("STOPPED");

    const result = await loginWahaSession();

    expect(posts(calls).map((c) => c.path)).toEqual([
      `/api/sessions/${SESSION}/start`,
    ]);
    expect(result).toMatchObject({ error: null, view: { state: "STARTING" } });
  });

  it("restarts a FAILED session", async () => {
    const calls = fakeWaha("FAILED");

    await loginWahaSession();

    expect(posts(calls).map((c) => c.path)).toEqual([
      `/api/sessions/${SESSION}/restart`,
    ]);
  });

  it.each(["STARTING", "SCAN_QR_CODE", "WORKING"])(
    "is a harmless no-op when the session is already %s",
    async (status) => {
      const calls = fakeWaha(status);

      const result = await loginWahaSession();

      expect(posts(calls)).toHaveLength(0);
      expect(result).toMatchObject({ error: null, view: { state: status } });
    },
  );

  it("surfaces WAHA's own message when start is refused, and still returns the view", async () => {
    fakeWaha("STOPPED", (c) =>
      c.method === "POST"
        ? { status: 422, body: { message: "Session is not allowed" } }
        : undefined,
    );

    const result = await loginWahaSession();

    expect(result.error).toBe("WAHA menjawab 422: Session is not allowed");
    expect(result.view.state).toBe("STOPPED");
  });

  it("does not attempt anything when WAHA cannot be read", async () => {
    const calls = stubWaha(() => new Error("connect ECONNREFUSED"));

    const result = await loginWahaSession();

    expect(posts(calls)).toHaveLength(0);
    expect(result.view.state).toBe("error");
    expect(result.error).toContain("tidak terjangkau");
  });

  it("explains what is missing when the base URL is not set", async () => {
    vi.stubEnv("WAHA_BASE_URL", "");
    resetDb();
    const calls = stubWaha(() => undefined);

    const result = await loginWahaSession();

    expect(calls).toHaveLength(0);
    expect(result.view.state).toBe("unconfigured");
    expect(result.error).toBe(describeSessionState("unconfigured").hint);
  });

  it("reports a network failure during start without throwing", async () => {
    fakeWaha("STOPPED", (c) =>
      c.method === "POST" ? new Error("socket hang up") : undefined,
    );

    const result = await loginWahaSession();

    expect(result.error).toContain("socket hang up");
  });
});

describe("logoutWahaSession", () => {
  it.each(["WORKING", "SCAN_QR_CODE"])("logs a %s session out", async (status) => {
    const calls = fakeWaha(status);

    const result = await logoutWahaSession();

    expect(posts(calls).map((c) => c.path)).toEqual([
      `/api/sessions/${SESSION}/logout`,
    ]);
    expect(result).toMatchObject({ error: null, view: { state: "STOPPED" } });
  });

  it.each([null, "STOPPED"])(
    "is a no-op when there is nothing logged in (%s)",
    async (status) => {
      const calls = fakeWaha(status);

      const result = await logoutWahaSession();

      expect(posts(calls)).toHaveLength(0);
      expect(result.error).toBeNull();
    },
  );

  it("surfaces WAHA's message when logout fails", async () => {
    fakeWaha("WORKING", (c) =>
      c.method === "POST"
        ? { status: 500, body: { message: "engine busy" } }
        : undefined,
    );

    const result = await logoutWahaSession();

    expect(result.error).toBe("WAHA menjawab 500: engine busy");
    expect(result.view.state).toBe("WORKING");
  });

  it("does not attempt anything when the API key is rejected", async () => {
    const calls = stubWaha(() => ({ status: 401, body: { message: "Unauthorized" } }));

    const result = await logoutWahaSession();

    expect(posts(calls)).toHaveLength(0);
    expect(result.view.state).toBe("rejected");
    expect(result.error).toBe("WAHA menjawab 401: Unauthorized");
  });
});

describe("session state helpers", () => {
  const ALL: WahaSessionState[] = [
    ...WAHA_SESSION_STATUSES,
    "not_created",
    "unconfigured",
    "error",
    "rejected",
    "UNKNOWN",
  ];

  it("offers Login only when nothing is running, Logout only when a login exists or is pending", () => {
    const login = ALL.filter(canLogin);
    const logout = ALL.filter(canLogout);

    expect(login).toEqual(["STOPPED", "FAILED", "not_created"]);
    expect(logout).toEqual(["STARTING", "SCAN_QR_CODE", "WORKING", "FAILED"]);
  });

  it("describes every state with a label, tone and hint", () => {
    for (const state of ALL) {
      const d = describeSessionState(state);
      expect(d.label).not.toBe("");
      expect(d.hint).not.toBe("");
    }
    expect(describeSessionState("WORKING").tone).toBe("ok");
    expect(describeSessionState("FAILED").tone).toBe("danger");
  });
});
