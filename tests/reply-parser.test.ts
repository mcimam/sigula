import { describe, expect, it } from "vitest";

import { OTHER_REASON_CODE } from "~/lib/reasons";
import { parseReply, type ReplyReason } from "~/lib/reply-parser";

const REASONS: ReplyReason[] = [
  { code: "1", label: "Kalah Harga" },
  { code: "2", label: "Stok Masih Ada" },
  { code: "3", label: "Sudah Bangkrut" },
];
const parse = (body: string, reasons = REASONS) => parseReply(body, reasons);
const quoted = (body: string) => parseReply(body, REASONS, { quoted: true });
const OTHER = OTHER_REASON_CODE;
const entry = (numbers: number[] | null, reasonCode: string, note = "") => ({ numbers, reasonCode, note });

describe("parseReply — one customer or several", () => {
  it("reads a number and a reason", () => {
    expect(parse("3 Kalah Harga")).toEqual({ entries: [entry([3], "1")], unrecognized: [] });
  });

  it("reads several numbers, however they are separated, and ranges", () => {
    expect(parse("1,2,5 stok masih ada").entries).toEqual([entry([1, 2, 5], "2")]);
    expect(parse("1 2 3 kalah harga").entries).toEqual([entry([1, 2, 3], "1")]);
    expect(parse("1 dan 4 kalah harga").entries).toEqual([entry([1, 4], "1")]);
    expect(parse("2 & 3 sudah bangkrut").entries).toEqual([entry([2, 3], "3")]);
    expect(parse("4-6 kalah harga").entries).toEqual([entry([4, 5, 6], "1")]);
    expect(parse("1, 3-4 stok masih ada").entries).toEqual([entry([1, 3, 4], "2")]);
  });

  it("no number means everyone (null)", () => {
    expect(parse("Sudah Bangkrut").entries).toEqual([entry(null, "3")]);
  });

  it("takes a multi-digit number as one number", () => {
    expect(parse("12 kalah harga").entries).toEqual([entry([12], "1")]);
  });
});

describe("parseReply — how it is written", () => {
  it("ignores case, punctuation, emoji and extra spaces", () => {
    for (const text of ["kalah harga", "KALAH HARGA", "Kalah Harga.", "  kalah   harga  ", "- kalah harga!", "👍 kalah harga", ": kalah harga"]) {
      expect(parse(text).entries, text).toEqual([entry(null, "1")]);
    }
    expect(parse("3) kalah harga").entries).toEqual([entry([3], "1")]);
    expect(parse("3. kalah harga").entries).toEqual([entry([3], "1")]);
    expect(parse("3: kalah harga").entries).toEqual([entry([3], "1")]);
    expect(parse("3-kalah harga").entries).toEqual([entry([3], "1")]);
  });

  it("one pair per line (also with Windows line ends), blank lines skipped", () => {
    expect(parse("1 kalah harga\r\n\r\n2 stok masih ada\n3 sudah bangkrut").entries).toEqual([
      entry([1], "1"),
      entry([2], "2"),
      entry([3], "3"),
    ]);
  });

  it("several pairs on one line", () => {
    expect(parse("1 kalah harga, 2 stok masih ada").entries).toEqual([entry([1], "1"), entry([2], "2")]);
  });

  it("keeps what follows the reason as a note", () => {
    expect(parse("3 kalah harga, pesaing lebih murah").entries).toEqual([entry([3], "1", "pesaing lebih murah")]);
    expect(parse("kalah harga - minta diskon").entries).toEqual([entry(null, "1", "minta diskon")]);
  });

  it("prefers the longer label when one contains another", () => {
    const reasons = [
      { code: "a", label: "Kalah" },
      { code: "b", label: "Kalah Harga" },
    ];
    expect(parse("kalah harga", reasons).entries).toEqual([entry(null, "b")]);
    expect(parse("kalah", reasons).entries).toEqual([entry(null, "a")]);
  });

  it("follows the reasons on offer, not a fixed list", () => {
    const reasons = [{ code: "9", label: "Pindah Toko" }];
    expect(parse("2 pindah toko", reasons).entries).toEqual([entry([2], "9")]);
    expect(parse("kalah harga", reasons)).toEqual({ entries: [], unrecognized: ["kalah harga"] });
  });
});

describe("parseReply — free text as the reason", () => {
  it("after a number, the salesman's own words are the reason", () => {
    expect(parse("1. Barang masih ada").entries).toEqual([entry([1], OTHER, "Barang masih ada")]);
    expect(parse("3 mungkin minggu depan").entries).toEqual([entry([3], OTHER, "mungkin minggu depan")]);
    expect(parse("1,2 toko tutup sementara").entries).toEqual([entry([1, 2], OTHER, "toko tutup sementara")]);
    expect(parse("2 hari lagi kalah harga").entries).toEqual([entry([2], OTHER, "hari lagi kalah harga")]);
  });

  it("an offered reason is still recognised as one, with the rest as its note", () => {
    expect(parse("1 Kalah Harga, pesaing murah").entries).toEqual([entry([1], "1", "pesaing murah")]);
  });

  it("without a number, free text is only an answer when the message quotes the reminder", () => {
    expect(parse("Barang masih ada")).toEqual({ entries: [], unrecognized: ["Barang masih ada"] });
    expect(quoted("Barang masih ada").entries).toEqual([entry(null, OTHER, "Barang masih ada")]);
  });

  it("in a quoted reply an offered reason and numbers work exactly as before", () => {
    expect(quoted("Kalah Harga").entries).toEqual([entry(null, "1")]);
    expect(quoted("2 stok masih ada").entries).toEqual([entry([2], "2")]);
    expect(quoted("3 barang masih ada").entries).toEqual([entry([3], OTHER, "barang masih ada")]);
  });

  it("several lines of free text in a quoted reply are one reason; a reason followed by words keeps them as its note", () => {
    expect(quoted("Barang masih ada\nnanti dihubungi lagi").entries).toEqual([entry(null, OTHER, "Barang masih ada nanti dihubungi lagi")]);
    expect(quoted("Kalah Harga\npesaing lebih murah").entries).toEqual([entry(null, "1", "pesaing lebih murah")]);
  });

  it("numbered free text and an unnumbered rest can be mixed in a quoted reply", () => {
    expect(quoted("1 toko tutup\nsisanya stok masih ada").entries).toEqual([
      entry([1], OTHER, "toko tutup"),
      entry(null, OTHER, "sisanya stok masih ada"),
    ]);
  });

  it("keeps the words as written, minus leading punctuation", () => {
    expect(parse("3) - Sedang libur lebaran!").entries).toEqual([entry([3], OTHER, "Sedang libur lebaran!")]);
  });
});

describe("parseReply — what it does not guess", () => {
  it("chatter without a number and without quoting the reminder is not an answer", () => {
    expect(parse("ok siap")).toEqual({ entries: [], unrecognized: ["ok siap"] });
    expect(parse("terima kasih\n2 kalah harga")).toEqual({ entries: [entry([2], "1")], unrecognized: ["terima kasih"] });
    expect(parse("kalah hargaku").entries).toEqual([]);
  });

  it("a number with nothing after it says nothing", () => {
    expect(parse("3")).toEqual({ entries: [], unrecognized: ["3"] });
    expect(parse("3.  ")).toEqual({ entries: [], unrecognized: ["3."] });
    expect(quoted("!!!").entries).toEqual([]);
  });

  it("refuses a backwards or absurd range and number 0", () => {
    expect(parse("3-1 kalah harga").entries).toEqual([]);
    expect(parse("1-9999 kalah harga").entries).toEqual([]);
    expect(parse("0 kalah harga").entries).toEqual([]);
  });

  it("an empty message holds nothing", () => {
    expect(parse("")).toEqual({ entries: [], unrecognized: [] });
    expect(parse("   \n  ")).toEqual({ entries: [], unrecognized: [] });
    expect(quoted("   ")).toEqual({ entries: [], unrecognized: [] });
  });
});
