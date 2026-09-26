import crypto from "node:crypto";

import { and, asc, count, desc, eq, gt, lt, ne, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  alive,
  customers,
  inboundMessages,
  notificationDeliveries,
  notificationItems,
  users,
  type InboundOutcome,
} from "~/db/schema";
import { addComment } from "~/lib/activity.server";
import { digitsOf, salesmanIdByWhatsapp } from "~/lib/contacts.server";
import { nowIso } from "~/lib/dates";
import { listFollowUpReasons, submitReason } from "~/lib/follow-ups.server";
import { pageWindow } from "~/lib/pagination";
import { pendingCustomerIds } from "~/lib/pending.server";
import { OTHER_REASON_CODE } from "~/lib/reasons";
import { parseReply } from "~/lib/reply-parser";
import { getWahaSettings } from "~/lib/settings.server";
import { createWahaClient, lookupPhoneByLid, type WahaClient } from "~/lib/waha.server";

/**
 * Salesmen answering a reminder on WhatsApp (ADR-0009). WAHA calls `POST /webhooks/waha`
 * for every incoming message; this module decides whether it is one of ours to act on,
 * records the reasons it holds exactly as the customer panel would, and answers with a
 * short confirmation. A message id is processed once (WAHA retries), and every message
 * from a known salesman — understood or not — is kept in `inbound_messages`.
 */

/**
 * Whether `signature` is the HMAC-SHA512 of the raw body under the shared secret (header
 * `X-Webhook-Hmac`). WAHA's docs do not name the encoding, so hex and base64 are both accepted.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const digest = (encoding: "hex" | "base64") => crypto.createHmac("sha512", secret).update(rawBody).digest(encoding);
  const same = (expected: string, actual: string) => {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const given = signature.trim();
  return same(digest("hex"), given.toLowerCase()) || same(digest("base64"), given);
}

const CONFIRMATION_LINES = 10;
/** Longest message text stored and parsed (WhatsApp allows far more; a reply is a sentence). */
const MAX_BODY = 2000;
/**
 * WAHA forwards every message the account receives — customers' chats included — so a message from a number that
 * is not a salesman's is not ours to keep: its text is dropped, only the number and the fact are logged, and only
 * the most recent of those.
 */
const KEEP_UNKNOWN_SENDERS = 200;
/** How long a salesman's messages are kept (DEBT-025: no written retention policy yet). */
const RETENTION_DAYS = 180;
/** A salesman who keeps writing things we do not understand is told how to reply once an hour. */
const HELP_COOLDOWN_MS = 60 * 60 * 1000;

type Recorded = { position: number; nama: string; reason: string };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The confirmation sent after reasons were recorded. Long lists are cut so the message stays readable. */
export function composeConfirmation(o: { recorded: Recorded[]; warnings: string[]; remaining: number }): string {
  const lines = [`✅ Tercatat: ${o.recorded.length} customer`];
  for (const r of o.recorded.slice(0, CONFIRMATION_LINES)) lines.push(`${r.position}. ${r.nama} — ${clip(r.reason, 80)}`);
  if (o.recorded.length > CONFIRMATION_LINES) lines.push(`…dan ${o.recorded.length - CONFIRMATION_LINES} lainnya`);
  for (const w of o.warnings) lines.push(`⚠️ ${w}`);
  lines.push(o.remaining > 0 ? `Sisa menunggu balasan: ${o.remaining} customer.` : "Semua customer di reminder ini sudah dijawab.");
  return lines.join("\n");
}

export function composeHelp(reasonLabels: string[]): string {
  const first = reasonLabels[0] ?? "Kalah Harga";
  return (
    `Balasan belum dikenali. Tekan Balas (reply) pada pesan reminder, lalu tulis nomor + alasan, ` +
    `mis. "3 ${first}" atau "1,2 ${first}", atau alasannya saja untuk semua customer. ` +
    `Pilihan alasan: ${reasonLabels.join(" / ")}; boleh juga alasan Anda sendiri.`
  );
}

export type ReceiveInput = {
  providerMessageId: string;
  session: string;
  /** The sender's number, digits only. */
  fromDigits: string;
  body: string;
  receivedAt: string;
  /** The id of the message that was quoted, when the salesman used "reply". */
  replyToId?: string | null;
  now?: Date;
};

export type Received =
  | { duplicate: true }
  | { duplicate: false; id: number; outcome: InboundOutcome; detail: string; reply: string | null; replyTo: string };

/**
 * The reminder a reply is about, among those that really reached the salesman: the one that
 * was quoted (`quoted: true` — the salesman pressed "Balas" on it, which is what makes free text
 * without a number an answer), else the newest still holding a customer that waits for an answer,
 * else simply the newest. (A run with a delivered message cannot be voided, so a voided one never appears.)
 */
function pickDelivery(
  salesmanId: number,
  replyToId: string | null | undefined,
  waiting: Set<number>,
): { delivery: (typeof notificationDeliveries.$inferSelect) | null; quoted: boolean } {
  const candidates = db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.salesmanId, salesmanId),
        eq(notificationDeliveries.recipientKind, "salesman"),
        eq(notificationDeliveries.channel, "whatsapp"),
        eq(notificationDeliveries.status, "sent"),
      ),
    )
    .orderBy(desc(notificationDeliveries.id))
    .all();
  if (replyToId) {
    const quoted = candidates.find(
      (d) => d.providerMessageId && (d.providerMessageId === replyToId || d.providerMessageId.endsWith(replyToId)),
    );
    if (quoted) return { delivery: quoted, quoted: true };
  }
  const holdingWaiting = candidates.find((d) =>
    db
      .select({ customerId: notificationItems.customerId })
      .from(notificationItems)
      .where(eq(notificationItems.deliveryId, d.id))
      .all()
      .some((i) => waiting.has(i.customerId)),
  );
  return { delivery: holdingWaiting ?? candidates[0] ?? null, quoted: false };
}

/** Keeps `inbound_messages` from growing without bound: old rows go, and so do all but the latest strangers'. */
function prune(now: Date) {
  db.delete(inboundMessages)
    .where(lt(inboundMessages.createdAt, nowIso(new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000))))
    .run();
  db.run(sql`DELETE FROM inbound_messages WHERE outcome = 'unknown_sender' AND id NOT IN (
    SELECT id FROM inbound_messages WHERE outcome = 'unknown_sender' ORDER BY id DESC LIMIT ${KEEP_UNKNOWN_SENDERS})`);
}

/**
 * Everything that touches the database for one message, in one go (no `await`), so a
 * retried webhook can never interleave with the first delivery of the same message.
 * Returns what to answer; sending it is the caller's job.
 */
export function receiveReply(input: ReceiveInput): Received {
  if (db.select({ id: inboundMessages.id }).from(inboundMessages).where(eq(inboundMessages.providerMessageId, input.providerMessageId)).get()) {
    return { duplicate: true };
  }
  const now = input.now ?? new Date();
  const salesmanId = salesmanIdByWhatsapp(input.fromDigits);
  const reasons = listFollowUpReasons();

  let context = ""; // which reminder the salesman was answering, once known
  const finish = (outcome: InboundOutcome, detailText: string, reply: string | null): Received => {
    const detail = [context, detailText].filter(Boolean).join(" — ");
    // Never answer a stranger, and do not repeat a non-confirmation more than once an hour.
    const replyAllowed =
      reply !== null &&
      salesmanId !== null &&
      (outcome === "recorded" ||
        !db
          .select({ id: inboundMessages.id })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.salesmanId, salesmanId),
              eq(inboundMessages.replyStatus, "sent"),
              ne(inboundMessages.outcome, "recorded"),
              gt(inboundMessages.createdAt, nowIso(new Date(now.getTime() - HELP_COOLDOWN_MS))),
            ),
          )
          .get());
    const row = db
      .insert(inboundMessages)
      .values({
        providerMessageId: input.providerMessageId,
        session: input.session,
        fromAddress: input.fromDigits,
        salesmanId,
        body: outcome === "unknown_sender" ? "" : input.body.slice(0, MAX_BODY),
        replyTo: input.replyToId ?? "",
        outcome,
        detail,
        replyText: replyAllowed ? reply : "",
        receivedAt: input.receivedAt,
        createdAt: nowIso(now),
      })
      .returning()
      .get();
    prune(now);
    return { duplicate: false, id: row.id, outcome, detail, reply: replyAllowed ? reply : null, replyTo: input.fromDigits };
  };

  if (salesmanId === null) return finish("unknown_sender", "nomor ini bukan kontak salesman", null);

  const pending = pendingCustomerIds();
  const { delivery, quoted } = pickDelivery(salesmanId, input.replyToId, pending);
  if (!delivery) {
    return finish("nothing_pending", "belum ada reminder terkirim", "Tidak ada reminder yang menunggu balasan alasan saat ini.");
  }

  context = quoted ? `membalas pengiriman #${delivery.runId}` : input.replyToId ? "mengutip pesan lain" : "";
  const parsed = parseReply(input.body.slice(0, MAX_BODY), reasons, { quoted });
  const unnumberedReasons = new Set(parsed.entries.filter((e) => e.numbers === null).map((e) => e.reasonCode));
  if (parsed.entries.length === 0 || unnumberedReasons.size > 1) {
    const why = parsed.entries.length === 0 ? "tidak ada alasan yang dikenali" : "beberapa alasan berbeda tanpa nomor";
    return finish("unrecognized", why, composeHelp(reasons.map((r) => r.label)));
  }

  // The customers of that reminder, by the number they had in the message.
  const items = db
    .select({
      customerId: notificationItems.customerId,
      position: notificationItems.position,
      nama: customers.nama,
      salesmanId: customers.salesmanId,
      deleted: customers.deletedAt,
    })
    .from(notificationItems)
    .innerJoin(customers, eq(customers.id, notificationItems.customerId))
    .where(eq(notificationItems.deliveryId, delivery.id))
    .all();
  const answerable = (i: (typeof items)[number]) => i.deleted === null && i.salesmanId === salesmanId && pending.has(i.customerId);

  const targets = new Map<number, { position: number; nama: string; reasonCode: string; note: string }>();
  const warnings: string[] = [];
  for (const entry of parsed.entries.filter((e) => e.numbers !== null)) {
    for (const n of entry.numbers!) {
      const item = items.find((i) => i.position === n);
      if (!item) warnings.push(`Nomor ${n} tidak ada di daftar.`);
      else if (item.deleted !== null || item.salesmanId !== salesmanId) warnings.push(`Nomor ${n} bukan customer Anda lagi.`);
      else if (!pending.has(item.customerId)) warnings.push(`Nomor ${n} sudah dijawab.`);
      else if (!targets.has(item.customerId)) {
        targets.set(item.customerId, { position: item.position ?? n, nama: item.nama, reasonCode: entry.reasonCode, note: entry.note });
      }
    }
  }
  // No number: every customer of the reminder still waiting that the message did not name.
  const everyone = parsed.entries.find((e) => e.numbers === null);
  if (everyone) {
    for (const item of items.filter(answerable)) {
      if (!targets.has(item.customerId)) {
        targets.set(item.customerId, { position: item.position ?? 0, nama: item.nama, reasonCode: everyone.reasonCode, note: everyone.note });
      }
    }
  }

  if (targets.size === 0) {
    const detail = warnings.length ? warnings.join(" ") : "tidak ada customer yang menunggu";
    const reply = ["Tidak ada customer yang menunggu balasan alasan saat ini.", ...warnings.map((w) => `⚠️ ${w}`)].join("\n");
    return finish("nothing_pending", detail, reply);
  }

  const user = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.salesmanId, salesmanId), alive(users), eq(users.isActive, true)))
    .orderBy(asc(users.id))
    .get();
  const label = new Map(reasons.map((r) => [r.code, r.label]));

  const recorded: Recorded[] = [];
  for (const [customerId, t] of targets) {
    const own = t.reasonCode === OTHER_REASON_CODE; // the salesman's own words are the reason
    try {
      submitReason({ customerId, kodeAlasan: t.reasonCode, actingUserId: user?.id ?? null, via: "WhatsApp", note: t.note });
    } catch {
      warnings.push(`${t.nama} tidak bisa dicatat.`);
      continue;
    }
    recorded.push({ position: t.position, nama: t.nama, reason: own ? t.note : (label.get(t.reasonCode) ?? t.reasonCode) });
    if (t.note && user && !own) {
      try {
        addComment({ entityType: "customer", entityId: customerId, body: t.note, authorId: user.id });
      } catch {
        // an over-long note is dropped; the reason itself is recorded
      }
    }
  }
  recorded.sort((a, b) => a.position - b.position);

  const stillWaiting = pendingCustomerIds();
  const remaining = items.filter((i) => i.deleted === null && i.salesmanId === salesmanId && stillWaiting.has(i.customerId)).length;
  const detail = [`${recorded.length} customer dicatat`, ...warnings].join("; ");
  return finish(recorded.length > 0 ? "recorded" : "nothing_pending", detail, composeConfirmation({ recorded, warnings, remaining }));
}

export type InboundDeps = {
  client: WahaClient;
  lookupLid: (lid: string) => Promise<string | null>;
  now?: Date;
};

export type InboundResult =
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "handled"; outcome: InboundOutcome; detail: string; replied: boolean };

/** The fields of a WAHA `message` event this module reads; anything else in the payload is ignored. */
type WahaMessageEvent = {
  event?: unknown;
  session?: unknown;
  payload?: { id?: unknown; from?: unknown; fromMe?: unknown; body?: unknown; timestamp?: unknown; replyTo?: { id?: unknown } | null };
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * One event from the WAHA webhook. Only a text message from a person's own chat, sent to
 * this session by someone else, is looked at; groups, status updates, our own messages
 * (which also arrive as events) and other sessions are ignored.
 */
export async function handleWahaEvent(
  raw: unknown,
  deps: InboundDeps = { client: createWahaClient(), lookupLid: lookupPhoneByLid },
): Promise<InboundResult> {
  const event = (raw ?? {}) as WahaMessageEvent;
  const p = event.payload;
  if (event.event !== "message" || !p) return { status: "ignored", reason: "bukan event message" };
  if (p.fromMe === true) return { status: "ignored", reason: "pesan dari kita sendiri" };
  if (str(event.session) !== getWahaSettings().session) return { status: "ignored", reason: "session lain" };

  const from = str(p.from);
  const id = str(p.id);
  if (!id || !str(p.body).trim()) return { status: "ignored", reason: "tanpa teks" };
  let digits: string | null = null;
  if (from.endsWith("@c.us")) digits = digitsOf(from.slice(0, -"@c.us".length));
  else if (from.endsWith("@lid")) digits = await deps.lookupLid(from);
  else return { status: "ignored", reason: "bukan chat pribadi" };
  if (!digits) return { status: "ignored", reason: "nomor pengirim tidak dikenali" };

  const seconds = typeof p.timestamp === "number" ? p.timestamp : null;
  const received = receiveReply({
    providerMessageId: id,
    session: str(event.session),
    fromDigits: digits,
    body: str(p.body),
    receivedAt: nowIso(seconds ? new Date(seconds * 1000) : (deps.now ?? new Date())),
    replyToId: str(p.replyTo?.id) || null,
    now: deps.now,
  });
  if (received.duplicate) return { status: "duplicate" };

  let replied = false;
  if (received.reply) {
    const sent = await deps.client.sendText(received.replyTo, received.reply);
    replied = sent.ok;
    db.update(inboundMessages)
      .set({ replyStatus: sent.ok ? "sent" : "failed" })
      .where(eq(inboundMessages.id, received.id))
      .run();
  }
  return { status: "handled", outcome: received.outcome, detail: received.detail, replied };
}

/** Log Audit's "Balasan WhatsApp": newest first, one page at a time. */
export function listInboundPage(requestedPage: number, pageSize: number) {
  const total = db.select({ n: count() }).from(inboundMessages).get()!.n;
  const { page, totalPages, offset } = pageWindow(total, requestedPage, pageSize);
  const rows = db.select().from(inboundMessages).orderBy(desc(inboundMessages.id)).limit(pageSize).offset(offset).all();
  return { rows, total, page, totalPages, pageSize };
}
