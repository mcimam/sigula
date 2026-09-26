/**
 * Reads what a salesman typed back to a reminder (ADR-0009). Plain module, no database:
 * the reasons come in as an argument.
 *
 *   "3 Kalah Harga"                one customer, by its number in the message
 *   "1,2,5 stok masih ada"         several ("1-3" is a range)
 *   "Sudah Bangkrut"               no number: every customer of that reminder still waiting
 *   "1 kalah harga, 2 stok masih ada" / one pair per line
 *   "3 kalah harga, pesaing murah" whatever follows an offered reason is kept as a note
 *   "3 barang masih ada"           free text: the salesman's own words are the reason
 *
 * Case, punctuation and emoji around the words do not matter. The reason may be free text,
 * but only where it is clearly meant as an answer: after a customer number, or anywhere in a
 * message that quotes the reminder (`quoted`). Free text with neither ("ok siap") is not an
 * answer — with no number it would apply to every customer — and is reported as not understood.
 */
import { OTHER_REASON_CODE } from "~/lib/reasons";

export type ReplyReason = { code: string; label: string };

export type ReplyEntry = {
  /** Line numbers in the reminder; null = no number given = every customer still waiting. */
  numbers: number[] | null;
  /** An offered reason's code, or `OTHER_REASON_CODE` when the salesman used their own words. */
  reasonCode: string;
  /** After an offered reason: the text that followed it ("pesaing murah"). For `OTHER_REASON_CODE`: the reason itself. */
  note: string;
};

export type ParsedReply = { entries: ReplyEntry[]; unrecognized: string[] };

export type ParseOptions = {
  /** The message quotes ("replies to") a reminder: then free text without a number is an answer too. */
  quoted?: boolean;
};

/** One number or a range ("3", "1-3"), then an optional separator to the next one. */
const NUMBER = /^\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?(?!\d)\s*(?:[,&+/]|\bdan\b)?/iu;
const MAX_RANGE = 200;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `{ numbers, rest }` for a line's leading numbers; null when a range is backwards or absurd. */
function takeNumbers(line: string): { numbers: number[]; rest: string } | null {
  const numbers: number[] = [];
  let rest = line;
  for (let m = NUMBER.exec(rest); m; m = NUMBER.exec(rest)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from || to - from > MAX_RANGE) return null;
    for (let n = from; n <= to; n++) numbers.push(n);
    rest = rest.slice(m[0].length);
  }
  return { numbers, rest };
}

/** The reason a text starts with, and what follows it. Longer labels are tried first. */
function takeReason(text: string, reasons: ReplyReason[]): { code: string; tail: string } | null {
  const trimmed = text.replace(/^[^\p{L}\p{N}]+/u, "");
  for (const r of [...reasons].sort((a, b) => b.label.length - a.label.length)) {
    const words = r.label.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
    const m = new RegExp(`^${words}(?![\\p{L}\\p{N}])[\\s.,;:!\\-–—]*(.*)$`, "isu").exec(trimmed);
    if (m) return { code: r.code, tail: m[1].trim() };
  }
  return null;
}

function parseLine(line: string, reasons: ReplyReason[], opts: ParseOptions): ReplyEntry[] | null {
  const taken = takeNumbers(line);
  if (!taken) return null;
  const reason = takeReason(taken.rest, reasons);
  if (!reason) {
    // The salesman's own words. Only with a number, or in a reply to the reminder.
    const words = taken.rest.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (!words || (taken.numbers.length === 0 && !opts.quoted)) return null;
    return [{ numbers: taken.numbers.length > 0 ? taken.numbers : null, reasonCode: OTHER_REASON_CODE, note: words }];
  }

  const entry: ReplyEntry = {
    numbers: taken.numbers.length > 0 ? taken.numbers : null,
    reasonCode: reason.code,
    note: reason.tail,
  };
  // "1 kalah harga, 2 stok masih ada": what follows is the next pair, not a note.
  if (/^\d/.test(reason.tail)) {
    const more = parseLine(reason.tail, reasons, opts);
    if (more) return [{ ...entry, note: "" }, ...more];
  }
  return [entry];
}

/**
 * Free text with no number that comes on more than one line is still one answer: "Kalah Harga"
 * followed by "pesaing murah" is one reason with a note, and two free-text lines are one reason.
 */
function mergeUnnumbered(entries: ReplyEntry[]): ReplyEntry[] {
  const free = entries.filter((e) => e.numbers === null && e.reasonCode === OTHER_REASON_CODE);
  if (free.length === 0) return entries;
  const words = free.map((e) => e.note).join(" ");
  const offered = entries.find((e) => e.numbers === null && e.reasonCode !== OTHER_REASON_CODE);
  const rest = entries.filter((e) => !free.includes(e));
  if (offered) {
    offered.note = [offered.note, words].filter(Boolean).join(" ");
    return rest;
  }
  return [...rest, { numbers: null, reasonCode: OTHER_REASON_CODE, note: words }];
}

export function parseReply(body: string, reasons: ReplyReason[], opts: ParseOptions = {}): ParsedReply {
  const entries: ReplyEntry[] = [];
  const unrecognized: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseLine(line, reasons, opts);
    if (parsed) entries.push(...parsed);
    else unrecognized.push(line);
  }
  return { entries: mergeUnnumbered(entries), unrecognized };
}
