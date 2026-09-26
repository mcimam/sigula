/**
 * Shared (client + server) contract for the WhatsApp session that WAHA hosts.
 * No `.server` suffix on purpose: `WahaSessionCard` imports it.
 */

/** Statuses WAHA itself reports for a session. */
export const WAHA_SESSION_STATUSES = [
  "STOPPED",
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "FAILED",
] as const;
export type WahaSessionStatus = (typeof WAHA_SESSION_STATUSES)[number];

/**
 * Where the session stands. The first four are our own findings (we could not
 * read a session at all); the rest are WAHA's. `UNKNOWN` is a status this app
 * does not know yet (WAHA adds new ones, e.g. passkey states).
 */
export type WahaSessionState =
  | "unconfigured"
  | "error"
  | "rejected"
  | "not_created"
  | "UNKNOWN"
  | WahaSessionStatus;

export type WahaSessionView = {
  state: WahaSessionState;
  /** The configured WAHA session name the state is about. */
  session: string;
  /** The linked WhatsApp account — only while `WORKING`. */
  account: { name: string | null; number: string | null } | null;
  /** Base64 QR image — only while `SCAN_QR_CODE` and once WAHA has produced it. */
  qr: { mimetype: string; data: string } | null;
  /** Why the session could not be read (`error` / `rejected`). */
  message: string | null;
};

/** What a login/logout call returns: the fresh view plus what went wrong, if anything. */
export type WahaSessionResult = {
  view: WahaSessionView;
  error: string | null;
};

export type SessionTone = "ok" | "warn" | "danger" | "muted";

export function describeSessionState(state: WahaSessionState): {
  label: string;
  tone: SessionTone;
  hint: string;
} {
  switch (state) {
    case "WORKING":
      return {
        label: "Terhubung",
        tone: "ok",
        hint: "WhatsApp sudah login dan siap mengirim pesan.",
      };
    case "SCAN_QR_CODE":
      return {
        label: "Menunggu scan QR",
        tone: "warn",
        hint: "Scan kode QR di bawah dengan WhatsApp di ponsel.",
      };
    case "STARTING":
      return {
        label: "Memulai sesi…",
        tone: "warn",
        hint: "Sesi sedang dinyalakan. Kode QR akan muncul sebentar lagi.",
      };
    case "STOPPED":
      return {
        label: "Belum login",
        tone: "muted",
        hint: "Tekan Login untuk menautkan nomor WhatsApp.",
      };
    case "FAILED":
      return {
        label: "Gagal",
        tone: "danger",
        hint: "Sesi gagal berjalan. Tekan Login untuk memulai ulang, atau Logout untuk membersihkannya.",
      };
    case "not_created":
      return {
        label: "Sesi belum dibuat",
        tone: "muted",
        hint: "Tekan Login untuk membuat sesi ini di WAHA dan menautkan nomor.",
      };
    case "unconfigured":
      return {
        label: "Base URL belum diisi",
        tone: "muted",
        hint: "Isi dan simpan Base URL WAHA di atas.",
      };
    case "rejected":
      return {
        label: "API key ditolak",
        tone: "danger",
        hint: "WAHA menolak API key yang tersimpan. Periksa di form di atas.",
      };
    case "error":
      return {
        label: "WAHA tidak terjangkau",
        tone: "danger",
        hint: "Periksa Base URL dan pastikan WAHA berjalan.",
      };
    default:
      return {
        label: "Status tidak dikenal",
        tone: "muted",
        hint: "WAHA melaporkan status yang belum dikenal aplikasi ini.",
      };
  }
}

/** Login (start / create / restart) makes sense only when nothing is running. */
export function canLogin(state: WahaSessionState): boolean {
  return state === "not_created" || state === "STOPPED" || state === "FAILED";
}

/** Logout makes sense while a session exists that holds, or is about to hold, a login. */
export function canLogout(state: WahaSessionState): boolean {
  return (
    state === "STARTING" ||
    state === "SCAN_QR_CODE" ||
    state === "WORKING" ||
    state === "FAILED"
  );
}

