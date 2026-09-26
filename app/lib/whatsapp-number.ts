/**
 * A WhatsApp number as WhatsApp wants it: digits only, with the country code. People type
 * numbers the way they say them ("0812-3456-7890", "+62 812 3456 7890"); WAHA needs
 * `62812…@c.us` and answers a chat id like `0812…@c.us` with a 500 (found in production,
 * where the salesmen's numbers were saved in the local form). Plain module: the sender,
 * the matching of an incoming message to a salesman, and the checks before a send all use it.
 *
 * The business is Indonesian (country code 62): a leading 0 is the national trunk prefix and
 * becomes 62, "0062…" is the international prefix, and an Indonesian mobile number typed
 * without its 0 ("812…", 9–12 digits) gets 62. A number typed with a "+" is already international.
 */
const COUNTRY_CODE = "62";

export function normalizeWhatsappNumber(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return COUNTRY_CODE + digits.slice(1);
  if (/^8\d{8,11}$/.test(digits)) digits = COUNTRY_CODE + digits;
  return digits;
}

/** Long enough to be a phone number and short enough (E.164: at most 15 digits) to be one. */
export const isPlausibleWhatsappNumber = (normalized: string) => /^\d{8,15}$/.test(normalized);
