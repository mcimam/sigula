/**
 * The business calendar. Every "today" the app decides on (overdue, order
 * date, cron) is a date in this zone — not the server's (a container often
 * runs in UTC, which would flip the date 7 hours early). Pinned rather than
 * read from the browser so server render and hydration agree.
 */
export const BUSINESS_TIMEZONE = "Asia/Jakarta";

/** Business-calendar date as YYYY-MM-DD. */
export function todayIso(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Moment in time as ISO-8601 UTC, second precision (`2026-09-26T08:15:00Z`). */
export function nowIso(d = new Date()): string {
  return d.toISOString().slice(0, 19) + "Z";
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysSinceOrder(
  lastOrderDate: string | null,
  today = todayIso(),
): number | null {
  if (!lastOrderDate) return null;
  return daysBetween(lastOrderDate, today);
}

/** BR-1 */
export function isOverdue(
  lastOrderDate: string | null,
  orderCycleDays: number,
  today = todayIso(),
): boolean {
  const days = daysSinceOrder(lastOrderDate, today);
  if (days === null) return true;
  return days > orderCycleDays;
}

/** What a customer list shows beside the last order: how long ago it was, and BR-1 applied to it. */
export function orderStanding(
  lastOrderDate: string | null,
  orderCycleDays: number,
  today = todayIso(),
) {
  return {
    daysSinceOrder: daysSinceOrder(lastOrderDate, today),
    overdue: isOverdue(lastOrderDate, orderCycleDays, today),
  };
}

export const sinceLabel = (days: number) => (days === 0 ? "hari ini" : `${days} hari lalu`);

/** "Overdue · 198 hari sejak order, siklus 14 hari" — the order status as a customer panel shows it. */
export function orderStatusText(c: {
  overdue: boolean;
  daysSinceOrder: number | null;
  orderCycleDays: number;
}) {
  const label = c.overdue ? "Overdue" : "On track";
  return c.daysSinceOrder === null
    ? `${label} · belum pernah order`
    : `${label} · ${c.daysSinceOrder} hari sejak order, siklus ${c.orderCycleDays} hari`;
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-08-22" → "22 Agu 2026". A fixed table, not `Intl`, so the text never depends on the ICU data of the server. */
export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

