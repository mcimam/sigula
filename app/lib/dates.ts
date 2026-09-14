/** Local calendar date as YYYY-MM-DD (pilot TZ is Asia/Jakarta / machine local). */
export function todayIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
