import type { Route } from "./+types/webhooks.waha";
import { handleWahaEvent, verifyWebhookSignature } from "~/lib/inbound.server";
import { getWahaSettings } from "~/lib/settings.server";

/** A message event is a few KB; nothing legitimate is near this. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * WAHA calls this for every incoming WhatsApp message (ADR-0009): how a salesman answers a
 * reminder. There is no session here. The HMAC signature is optional, as it is in WAHA: with a
 * shared secret set (Pengaturan → Koneksi WAHA) the caller must prove itself by the HMAC of the
 * body (`X-Webhook-Hmac`) or gets 401; with no secret the call is taken on trust (DEBT-020).
 * A message that is not ours to act on still gets 200, so WAHA does not retry it; only a real
 * failure answers 5xx, and a retry of the same message is harmless (it is processed once).
 */
export async function action({ request }: Route.ActionArgs) {
  const { webhookSecret } = getWahaSettings();

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new Response("Terlalu besar", { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Response("Terlalu besar", { status: 413 });
  if (webhookSecret && !verifyWebhookSignature(raw, request.headers.get("X-Webhook-Hmac"), webhookSecret)) {
    throw new Response("Tanda tangan tidak valid", { status: 401 });
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new Response("Bukan JSON", { status: 400 });
  }
  return await handleWahaEvent(event);
}
