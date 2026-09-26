import { and, asc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { messageTemplates, type Channel } from "~/db/schema";
import { logActivity } from "~/lib/activity.server";
import { daysSinceOrder } from "~/lib/dates";
import { TEMPLATE_PLACEHOLDERS, type TemplateVars } from "~/lib/template-vars";

/**
 * Editable message text per code + channel (ERD D8). Editing never changes a
 * row: it inserts version n+1 and retires version n, so every delivery keeps
 * pointing at the exact text it sent.
 */

/**
 * Channels whose templates the admin can see and edit. Email templates exist
 * (seeded, versioned like the rest) but stay hidden until an email sender
 * exists, so an unusable text is not offered for editing.
 */
export const EDITABLE_TEMPLATE_CHANNELS: readonly Channel[] = ["whatsapp"]; // DEBT-014

export const TEMPLATE_CODES = {
  reminder_salesman: "Pengingat ke salesman",
  reminder_supervisor: "Ringkasan ke supervisor",
} as const;
export type TemplateCode = keyof typeof TEMPLATE_CODES;

/** What the preview on the settings page fills the placeholders with. */
export const SAMPLE_VARS: TemplateVars = {
  nama: "Andi",
  jumlah: 3,
  tanggal: "22 Agu 2026",
  daftar_customer: [
    "1. Toko A — 151 hari (siklus normal 30 hari)",
    "2. Toko B — 62 hari (siklus normal 30 hari)",
    "3. Toko C — 32 hari (siklus normal 30 hari)",
  ].join("\n"),
  daftar_alasan: "Kalah Harga / Stok Masih Ada / Sudah Bangkrut",
};

/**
 * The order a reminder lists its customers in: the longest without an order first. A
 * customer that never ordered has no day count and comes first; equal days go by name.
 * The position in this list is the number in the message, and what a reply's "3" means
 * (`notification_items.position`), so the message and the stored rows share this one order.
 */
export function orderByWait<T extends { nama: string; lastOrderDate: string | null }>(list: T[], today: string) {
  return list
    .map((c) => ({ ...c, days: daysSinceOrder(c.lastOrderDate, today) }))
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || a.nama.localeCompare(b.nama));
}

/**
 * The customer list of a reminder (`{{daftar_customer}}`): one numbered line each, in
 * `orderByWait` order — "1. TOKO A — 151 hari (siklus normal 30 hari)".
 */
export function customerLines(
  list: { nama: string; lastOrderDate: string | null; orderCycleDays: number }[],
  today: string,
): string {
  return orderByWait(list, today)
    .map(
      (c, i) =>
        `${i + 1}. ${c.nama} — ${c.days === null ? "belum pernah order" : `${c.days} hari`} (siklus normal ${c.orderCycleDays} hari)`,
    )
    .join("\n");
}

const MAX_BODY = 2000;
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(PLACEHOLDER, (whole, key: string) =>
    key in vars ? String(vars[key as keyof TemplateVars]) : whole,
  );
}

export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((k) => !known.has(k));
}

/** The live version for a code + channel. A missing one is corrupt reference data, not a user error. */
export function activeTemplate(code: TemplateCode, channel: Channel) {
  const row = db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.code, code),
        eq(messageTemplates.channel, channel),
        eq(messageTemplates.isActive, true),
      ),
    )
    .get();
  if (!row) throw new Error(`Template ${code}/${channel} tidak ditemukan`);
  return row;
}

/** Active templates the UI may show, in a stable order. */
export function listEditableTemplates() {
  return db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.isActive, true))
    .orderBy(asc(messageTemplates.code), asc(messageTemplates.channel))
    .all()
    .filter((t) => EDITABLE_TEMPLATE_CHANNELS.includes(t.channel));
}

/**
 * Saves `body` (and, for email, `subject`) as the next version. Rejects text
 * that is empty, too long, or uses a placeholder the sender cannot fill.
 * Saving the text that is already live is a no-op (returns it unchanged).
 */
export function saveTemplateVersion(opts: {
  code: TemplateCode;
  channel: Channel;
  body: string;
  subject?: string;
  createdById: number | null;
}) {
  const body = opts.body.replace(/\r\n/g, "\n").trim();
  const subject = (opts.subject ?? "").trim();
  if (!body) throw new Error("Isi template tidak boleh kosong");
  if (body.length > MAX_BODY) throw new Error(`Isi template maksimal ${MAX_BODY} karakter`);
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  if (unknown.length > 0) {
    throw new Error(
      `Placeholder tidak dikenal: ${unknown.map((k) => `{{${k}}}`).join(", ")}. ` +
        `Yang tersedia: ${TEMPLATE_PLACEHOLDERS.map((k) => `{{${k}}}`).join(", ")}`,
    );
  }

  const current = activeTemplate(opts.code, opts.channel);
  if (current.body === body && current.subject === subject) return current;

  const next = db.transaction((tx) => {
    tx.update(messageTemplates).set({ isActive: false }).where(eq(messageTemplates.id, current.id)).run();
    return tx
      .insert(messageTemplates)
      .values({
        code: current.code,
        channel: current.channel,
        recipientKind: current.recipientKind,
        subject,
        body,
        version: current.version + 1,
        isActive: true,
        createdById: opts.createdById,
      })
      .returning()
      .get();
  });

  logActivity({
    entityType: "template",
    entityId: next.id,
    entityLabel: `${TEMPLATE_CODES[opts.code]} (${opts.channel}) v${next.version}`,
    action: "update",
    actorId: opts.createdById,
    changes: {
      ...(current.body !== body ? { body: { from: current.body, to: body } } : {}),
      ...(current.subject !== subject ? { subject: { from: current.subject, to: subject } } : {}),
    },
  });
  return next;
}
