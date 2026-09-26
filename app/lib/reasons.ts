/**
 * The reason recorded when a salesman answers in their own words instead of one of the offered
 * reasons ("Barang masih ada"). It is a row of `follow_up_reasons` (seeded by migration 0009) so
 * a follow-up always has a reason; the words themselves go in `follow_ups.note` and in the
 * activity. It is never offered as a choice and never deactivates a customer.
 */
export const OTHER_REASON_CODE = "other";

/** Longest free-text reason kept (longer is cut with "…"). */
export const MAX_REASON_TEXT = 500;

export function clipReasonText(text: string): string {
  const t = text.trim();
  return t.length > MAX_REASON_TEXT ? `${t.slice(0, MAX_REASON_TEXT - 1)}…` : t;
}
