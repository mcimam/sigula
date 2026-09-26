import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";

/**
 * Display names for messages and the audit trail. They read soft-deleted rows
 * too, so history stays readable after a record is deleted (ADR-0005); a row that
 * does not exist at all shows as `#id`.
 */
export const customerName = (id: number): string =>
  db.select({ n: customers.nama }).from(customers).where(eq(customers.id, id)).get()?.n ?? `#${id}`;

export function salesmanName(id: number): string;
/** `null` in, `null` out — for optional links such as a supervisor. */
export function salesmanName(id: number | null): string | null;
export function salesmanName(id: number | null): string | null {
  if (id == null) return null;
  return db.select({ n: salesmen.nama }).from(salesmen).where(eq(salesmen.id, id)).get()?.n ?? `#${id}`;
}
