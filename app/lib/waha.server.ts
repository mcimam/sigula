import { formatStamp } from "~/lib/activity-format";
import { getWahaSettings } from "~/lib/settings.server";
import { normalizeWhatsappNumber } from "~/lib/whatsapp-number";
import {
  WAHA_SESSION_STATUSES,
  canLogin,
  canLogout,
  describeSessionState,
  type WahaSessionResult,
  type WahaSessionView,
} from "~/lib/waha-session";

export type WahaSendResult = {
  ok: boolean;
  errorMessage?: string;
  /** WAHA's id for the sent message, when it returned one. */
  messageId?: string;
};

export type WahaClient = {
  sendText: (nomorWa: string, text: string) => Promise<WahaSendResult>;
};

function chatId(nomorWa: string) {
  return `${normalizeWhatsappNumber(nomorWa)}@c.us`;
}

/** What WAHA said when it refused, on one short line — "500 Internal Server Error" alone says nothing. */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, " ").trim().slice(0, 160);
  } catch {
    return "";
  }
}

/**
 * WAHA answers `sendText` with 201 as soon as it has *handed the message to WhatsApp* — before
 * WhatsApp has accepted it. The verdict comes later as the message's `ack`: -1 error, 0 pending,
 * 1 reached WhatsApp's server, 2 reached the phone, 3 read. A message WhatsApp refuses (for example
 * while the account is under a reachout timelock) is therefore a 201 followed by -1, and a sender
 * that stops at the 201 reports a message that never left as sent.
 */
const ACK_ERROR = -1;
const ACK_PENDING = 0;
const ACK_POLL_MS = 500;
/** How long a send waits for WhatsApp's verdict while it is still pending. */
const DEFAULT_ACK_WAIT_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWahaClient(overrides?: {
  baseUrl?: string;
  session?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** How long to wait for WhatsApp's verdict after WAHA accepted the message. 0 = look once. */
  ackWaitMs?: number;
}): WahaClient {
  const saved = getWahaSettings();
  const baseUrl = (
    overrides?.baseUrl ??
    saved.baseUrl ??
    ""
  ).replace(/\/$/, "");
  const session = overrides?.session ?? saved.session ?? "default";
  const apiKey = overrides?.apiKey ?? saved.apiKey ?? "";
  const timeoutMs = overrides?.timeoutMs ?? saved.timeoutMs ?? 8000;
  const ackWaitMs = overrides?.ackWaitMs ?? DEFAULT_ACK_WAIT_MS;

  return {
    async sendText(nomorWa, text) {
      if (!baseUrl) {
        return { ok: false, errorMessage: "WAHA_BASE_URL is not set" };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/api/sendText`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-Api-Key": apiKey } : {}),
          },
          body: JSON.stringify({
            session,
            chatId: chatId(nomorWa),
            text,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await readErrorDetail(res);
          return {
            ok: false,
            errorMessage: `WAHA returned ${res.status}: ${res.statusText}${detail ? ` — ${detail}` : ""}`,
          };
        }
        const messageId = await readMessageId(res);
        clearTimeout(timer); // the send is over; waiting for WhatsApp's verdict has its own limit
        if (messageId) {
          const refusal = await findRefusal(
            { ...saved, baseUrl, session, apiKey, timeoutMs },
            chatOfMessage(messageId) ?? chatId(nomorWa),
            messageId,
            ackWaitMs,
          );
          if (refusal) return { ok: false, errorMessage: refusal, messageId };
        }
        return { ok: true, messageId };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, errorMessage: `WAHA unreachable: ${reason}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** WAHA message ids are `true_<chat>_<short id>`; the chat may be `…@lid` rather than the `…@c.us` we addressed. */
function chatOfMessage(messageId: string): string | null {
  return /^(?:true|false)_(.+)_[^_]+$/.exec(messageId)?.[1] ?? null;
}

/**
 * Asks WhatsApp's verdict on a message WAHA accepted and returns why it was refused, or null when
 * it was not (accepted, still pending after `waitMs`, or WAHA cannot say — in doubt the message is
 * reported as sent, never as failed). DEBT-027: a message still pending when `waitMs` is over is not
 * followed up; WAHA could push the verdict (`message.ack`), which SiGula does not subscribe to.
 */
async function findRefusal(conn: WahaConn, chat: string, messageId: string, waitMs: number): Promise<string | null> {
  const path = `/api/${encodeURIComponent(conn.session)}/chats/${encodeURIComponent(chat)}/messages/${encodeURIComponent(messageId)}`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const call = await wahaCall(conn, path);
    const ack = call.reached && call.ok && isRecord(call.body) && typeof call.body.ack === "number" ? call.body.ack : null;
    if (ack === null || ack > ACK_PENDING) return null;
    if (ack === ACK_ERROR) return refusalMessage(conn);
    if (Date.now() >= deadline) return null;
    await sleep(ACK_POLL_MS);
  }
}

/** Why WhatsApp refused a message, in words an admin can act on. */
async function refusalMessage(conn: WahaConn): Promise<string> {
  const restriction = await readRestriction(conn);
  if (restriction) {
    return (
      "WhatsApp menolak pesan ini: akun pengirim sedang dibatasi WhatsApp (reachout timelock), " +
      "hanya bisa mengirim ke kontak yang lebih dulu mengirim pesan ke nomor SiGula" +
      (restriction.until ? `, sampai ${formatStamp(restriction.until)} WIB` : "") +
      ". Minta penerima mengirim satu pesan ke nomor SiGula, lalu kirim ulang."
    );
  }
  return (
    "WhatsApp menolak pesan ini (status ERROR): nomor penerima tidak terdaftar di WhatsApp, " +
    "atau akun pengirim sedang dibatasi. Periksa nomornya dan status Sesi WhatsApp di Pengaturan."
  );
}

/** The session's own record: `me.reachoutTimelock` is there, not always in the session list. */
async function readRestriction(conn: WahaConn): Promise<WahaSessionView["restriction"]> {
  const call = await wahaCall(conn, `/api/sessions/${encodeURIComponent(conn.session)}`);
  return call.reached && call.ok && isRecord(call.body) ? parseRestriction(call.body.me) : null;
}

/** WAHA answers a send with the message; its id is a string or `{ _serialized }`. Best effort — never fails the send. */
async function readMessageId(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { id?: unknown };
    if (typeof body?.id === "string") return body.id;
    const serialized = (body?.id as { _serialized?: unknown } | undefined)?._serialized;
    return typeof serialized === "string" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * WhatsApp sometimes shows a sender as an anonymous `<n>@lid` instead of `<phone>@c.us`.
 * WAHA can map it back (`GET /api/{session}/lids/{lid}` → `{ lid, pn }`); `pn` is null when it
 * does not know. Returns the phone number's digits, or null — never throws.
 */
export async function lookupPhoneByLid(lid: string): Promise<string | null> {
  const { baseUrl, session, apiKey, timeoutMs } = getWahaSettings();
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(lid)}`, {
      headers: apiKey ? { "X-Api-Key": apiKey } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pn?: unknown };
    return typeof body.pn === "string" ? normalizeWhatsappNumber(body.pn) || null : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ping WAHA — list sessions if available, else root reachability. */
export async function testWahaConnection(overrides?: {
  baseUrl?: string;
  session?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<WahaSendResult> {
  const saved = getWahaSettings();
  const baseUrl = (overrides?.baseUrl ?? saved.baseUrl).replace(/\/$/, "");
  if (!baseUrl) {
    return { ok: false, errorMessage: "Base URL WAHA belum diisi" };
  }
  const apiKey = overrides?.apiKey ?? saved.apiKey;
  const timeoutMs = overrides?.timeoutMs ?? saved.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: {
        ...(apiKey ? { "X-Api-Key": apiKey } : {}),
      },
      signal: controller.signal,
    });
    if (res.ok || res.status === 401 || res.status === 403) {
      return { ok: true };
    }
    return {
      ok: false,
      errorMessage: `WAHA returned ${res.status}: ${res.statusText}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, errorMessage: `WAHA unreachable: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── WhatsApp session (login / logout / status) ──────────────────────────────
// Mirrors the WAHA dashboard's session controls. Every function here reads the
// saved WAHA settings, never throws, and never puts the API key in what it
// returns — the result goes to the browser.

/** start/logout can take longer than a text send; never go below this. */
const SESSION_ACTION_MIN_TIMEOUT_MS = 15_000;
const QR_MIMETYPES = new Set(["image/png", "image/jpeg"]);
const QR_MAX_BASE64_LENGTH = 200_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type WahaConn = ReturnType<typeof readConn>;

type WahaCall =
  | { reached: true; status: number; ok: boolean; body: unknown }
  | { reached: false; message: string };

function readConn() {
  const saved = getWahaSettings();
  return { ...saved, baseUrl: saved.baseUrl.replace(/\/$/, "") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function wahaCall(
  conn: WahaConn,
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<WahaCall> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? conn.timeoutMs,
  );
  try {
    const hasBody = init?.body !== undefined;
    const res = await fetch(`${conn.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(conn.apiKey ? { "X-Api-Key": conn.apiKey } : {}),
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null; // a proxy error page or an empty body — status is what matters
    }
    return { reached: true, status: res.status, ok: res.ok, body };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { reached: false, message: `WAHA tidak terjangkau: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/** "WAHA menjawab 422: <message>" — only the JSON `message`, capped. */
function wahaErrorMessage(call: Extract<WahaCall, { reached: true }>): string {
  const raw = isRecord(call.body) ? call.body.message : undefined;
  const text = Array.isArray(raw)
    ? raw.filter((part) => typeof part === "string").join("; ")
    : typeof raw === "string"
      ? raw
      : "";
  const detail = text.trim().slice(0, 200);
  return detail
    ? `WAHA menjawab ${call.status}: ${detail}`
    : `WAHA menjawab ${call.status}`;
}

function parseAccount(me: unknown): WahaSessionView["account"] {
  if (!isRecord(me)) return null;
  const digits = typeof me.id === "string" ? /^(\d+)/.exec(me.id)?.[1] : null;
  const name =
    typeof me.pushName === "string" && me.pushName.trim()
      ? me.pushName.trim()
      : null;
  if (!digits && !name) return null;
  return { name, number: digits ? `+${digits}` : null };
}

/**
 * `me.reachoutTimelock` = `{ isActive, enforcementType, timeEnforcementEnds }` (seconds since the
 * epoch). One that already ended is not a restriction, whatever `isActive` still says.
 */
function parseRestriction(me: unknown, now = Date.now()): WahaSessionView["restriction"] {
  if (!isRecord(me) || !isRecord(me.reachoutTimelock) || me.reachoutTimelock.isActive !== true) return null;
  const ends = me.reachoutTimelock.timeEnforcementEnds;
  if (typeof ends !== "number" || !Number.isFinite(ends)) return { until: null };
  const untilMs = ends > 1e12 ? ends : ends * 1000;
  return untilMs <= now ? null : { until: new Date(untilMs).toISOString() };
}

/** The QR ends up in an <img src="data:…">, so only trust a plain base64 image. */
function parseQr(body: unknown): WahaSessionView["qr"] {
  if (!isRecord(body)) return null;
  const { mimetype, data } = body;
  if (
    typeof mimetype !== "string" ||
    !QR_MIMETYPES.has(mimetype) ||
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > QR_MAX_BASE64_LENGTH ||
    !BASE64.test(data)
  ) {
    return null;
  }
  return { mimetype, data };
}

async function readView(conn: WahaConn): Promise<WahaSessionView> {
  const view: WahaSessionView = {
    state: "unconfigured",
    session: conn.session,
    account: null,
    qr: null,
    message: null,
    restriction: null,
  };
  if (!conn.baseUrl) return view;

  // Session existence comes from the list, not GET /api/sessions/{name}: a
  // session that does not exist answers 403 there (seen on WAHA 2026.8.2), which
  // cannot be told apart from a rejected API key. `all=true` includes STOPPED ones.
  const list = await wahaCall(conn, "/api/sessions?all=true");
  if (!list.reached) return { ...view, state: "error", message: list.message };
  if (list.status === 401 || list.status === 403) {
    return { ...view, state: "rejected", message: wahaErrorMessage(list) };
  }
  if (!list.ok) {
    return { ...view, state: "error", message: wahaErrorMessage(list) };
  }
  if (!Array.isArray(list.body)) {
    return { ...view, state: "error", message: "Respons WAHA tidak dikenali" };
  }

  const found = list.body.find(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.name === conn.session,
  );
  if (!found) return { ...view, state: "not_created" };

  const status = WAHA_SESSION_STATUSES.find((s) => s === found.status);
  if (!status) return { ...view, state: "UNKNOWN" };

  if (status === "WORKING") {
    return {
      ...view,
      state: status,
      account: parseAccount(found.me),
      // The list may leave `reachoutTimelock` out of `me`; the session's own record has it.
      restriction:
        "reachoutTimelock" in (isRecord(found.me) ? found.me : {})
          ? parseRestriction(found.me)
          : await readRestriction(conn),
    };
  }
  if (status === "SCAN_QR_CODE") {
    // The QR may not be ready yet; the card polls, so a miss is just "not yet".
    const qr = await wahaCall(
      conn,
      `/api/${encodeURIComponent(conn.session)}/auth/qr`,
    );
    return {
      ...view,
      state: status,
      qr: qr.reached && qr.ok ? parseQr(qr.body) : null,
    };
  }
  return { ...view, state: status };
}

/** Why login/logout cannot even be attempted, or null when it can. */
function blockedReason(view: WahaSessionView): string | null {
  switch (view.state) {
    case "unconfigured":
    case "error":
    case "rejected":
    case "UNKNOWN":
      return view.message ?? describeSessionState(view.state).hint;
    default:
      return null;
  }
}

/** Current status of the configured session (plus the QR while it is waiting to be scanned). */
export function getWahaSessionView(): Promise<WahaSessionView> {
  return readView(readConn());
}

/**
 * Login = what the dashboard's Start does: create the session if WAHA has none,
 * start it if stopped, restart it if failed. Already starting / waiting for a
 * scan / working is a no-op, so a double click or a stale page is harmless.
 */
export async function loginWahaSession(): Promise<WahaSessionResult> {
  const conn = readConn();
  const before = await readView(conn);
  const blocked = blockedReason(before);
  if (blocked) return { view: before, error: blocked };
  if (!canLogin(before.state)) return { view: before, error: null };

  const seg = encodeURIComponent(conn.session);
  const timeoutMs = Math.max(conn.timeoutMs, SESSION_ACTION_MIN_TIMEOUT_MS);
  const call =
    before.state === "not_created"
      ? await wahaCall(conn, "/api/sessions", {
          method: "POST",
          body: { name: conn.session, start: true },
          timeoutMs,
        })
      : await wahaCall(
          conn,
          `/api/sessions/${seg}/${before.state === "FAILED" ? "restart" : "start"}`,
          { method: "POST", timeoutMs },
        );
  return { view: await readView(conn), error: callError(call) };
}

/**
 * Logout = the dashboard's Logout: WAHA drops the linked WhatsApp login and
 * stops the session, so the next Login needs a new QR scan. Already logged out
 * is a no-op.
 */
export async function logoutWahaSession(): Promise<WahaSessionResult> {
  const conn = readConn();
  const before = await readView(conn);
  const blocked = blockedReason(before);
  if (blocked) return { view: before, error: blocked };
  if (!canLogout(before.state)) return { view: before, error: null };

  const call = await wahaCall(
    conn,
    `/api/sessions/${encodeURIComponent(conn.session)}/logout`,
    {
      method: "POST",
      timeoutMs: Math.max(conn.timeoutMs, SESSION_ACTION_MIN_TIMEOUT_MS),
    },
  );
  return { view: await readView(conn), error: callError(call) };
}

function callError(call: WahaCall): string | null {
  if (!call.reached) return call.message;
  return call.ok ? null : wahaErrorMessage(call);
}
