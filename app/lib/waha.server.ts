import { getWahaSettings } from "~/lib/settings.server";

export type WahaSendResult = { ok: boolean; errorMessage?: string };

export type WahaClient = {
  sendText: (nomorWa: string, text: string) => Promise<WahaSendResult>;
};

function chatId(nomorWa: string) {
  const digits = nomorWa.replace(/\D/g, "");
  return `${digits}@c.us`;
}

export function createWahaClient(overrides?: {
  baseUrl?: string;
  session?: string;
  apiKey?: string;
  timeoutMs?: number;
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
          return {
            ok: false,
            errorMessage: `WAHA returned ${res.status}: ${res.statusText}`,
          };
        }
        return { ok: true };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, errorMessage: `WAHA unreachable: ${reason}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
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
