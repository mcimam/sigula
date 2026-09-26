import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, salesmanContacts, type Channel } from "~/db/schema";
import { nowIso } from "~/lib/dates";
import { normalizeWhatsappNumber } from "~/lib/whatsapp-number";

/**
 * How to reach a salesman (ERD D8). `salesman_contacts` holds one live primary
 * contact per channel; only WhatsApp has a sender and a form today, so this
 * module is WhatsApp-shaped on the write side and channel-generic on the read side.
 */
/** A live primary contact on `channel` — the one a message is sent to. */
const primaryOn = (channel: Channel) =>
  and(eq(salesmanContacts.channel, channel), eq(salesmanContacts.isPrimary, true), alive(salesmanContacts));

export function primaryContact(salesmanId: number, channel: Channel) {
  return db
    .select()
    .from(salesmanContacts)
    .where(and(eq(salesmanContacts.salesmanId, salesmanId), primaryOn(channel)))
    .get();
}

/** The salesman's WhatsApp number, or "" when there is none. */
export function whatsappNumber(salesmanId: number): string {
  return primaryContact(salesmanId, "whatsapp")?.address ?? "";
}

/**
 * The salesman whose primary WhatsApp number is `number` — who is writing to us. Both sides are
 * compared as WhatsApp sees them (`normalizeWhatsappNumber`: "+62 812-…", "0812…" and "62812…" are
 * one number), the way `sendText` addresses a chat. Null for a stranger.
 */
export function salesmanIdByWhatsapp(number: string): number | null {
  const digits = normalizeWhatsappNumber(number);
  if (!digits) return null;
  const contacts = db
    .select({ salesmanId: salesmanContacts.salesmanId, address: salesmanContacts.address })
    .from(salesmanContacts)
    .where(primaryOn("whatsapp"))
    .all();
  return contacts.find((c) => normalizeWhatsappNumber(c.address) === digits)?.salesmanId ?? null;
}

/**
 * Sets the WhatsApp number as typed in the salesman form: a blank removes the
 * contact (soft delete), a new number replaces the address of the existing
 * primary contact, and nothing is written when it did not change.
 */
export function setWhatsappNumber(salesmanId: number, raw: string) {
  const address = raw.trim();
  const current = primaryContact(salesmanId, "whatsapp");
  if (!address) {
    if (current) {
      db.update(salesmanContacts)
        .set({ deletedAt: nowIso() })
        .where(eq(salesmanContacts.id, current.id))
        .run();
    }
    return;
  }
  if (!current) {
    db.insert(salesmanContacts)
      .values({ salesmanId, channel: "whatsapp", address, isPrimary: true })
      .run();
    return;
  }
  if (current.address !== address) {
    // A different number is no longer the one that was verified.
    db.update(salesmanContacts)
      .set({ address, isVerified: false })
      .where(eq(salesmanContacts.id, current.id))
      .run();
  }
}

/** Adds `nomorWa` (their primary WhatsApp number, "" if none) to each salesman row — one query. */
export function attachWhatsapp<T extends { id: number }>(rows: T[]): (T & { nomorWa: string })[] {
  if (rows.length === 0) return [];
  const numbers = new Map(
    db
      .select({ salesmanId: salesmanContacts.salesmanId, address: salesmanContacts.address })
      .from(salesmanContacts)
      .where(
        and(
          inArray(
            salesmanContacts.salesmanId,
            rows.map((r) => r.id),
          ),
          primaryOn("whatsapp"),
        ),
      )
      .all()
      .map((c) => [c.salesmanId, c.address]),
  );
  return rows.map((r) => ({ ...r, nomorWa: numbers.get(r.id) ?? "" }));
}
