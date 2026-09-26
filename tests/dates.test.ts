import { describe, expect, it } from "vitest";

import { daysSinceOrder, formatDateShort, isOverdue, nowIso, orderStanding, todayIso } from "../app/lib/dates";

describe("isOverdue (BR-1)", () => {
  it("treats never-ordered as overdue", () => {
    expect(isOverdue(null, 30, "2026-09-12")).toBe(true);
  });

  it("is not overdue when days == cycle", () => {
    expect(isOverdue("2026-08-13", 30, "2026-09-12")).toBe(false);
  });

  it("is overdue when days > cycle", () => {
    expect(isOverdue("2026-08-12", 30, "2026-09-12")).toBe(true);
  });

  it("supports a 1-day cycle", () => {
    expect(isOverdue("2026-09-10", 1, "2026-09-12")).toBe(true);
    expect(isOverdue("2026-09-11", 1, "2026-09-12")).toBe(false);
  });
});

describe("daysSinceOrder", () => {
  it("returns null when never ordered", () => {
    expect(daysSinceOrder(null, "2026-09-12")).toBeNull();
  });

  it("counts calendar days", () => {
    expect(daysSinceOrder("2026-09-01", "2026-09-12")).toBe(11);
  });
});

describe("orderStanding", () => {
  it("is on track while the days since the last order stay within the cycle", () => {
    expect(orderStanding("2026-08-13", 30, "2026-09-12")).toEqual({ daysSinceOrder: 30, overdue: false });
    expect(orderStanding("2026-09-12", 30, "2026-09-12")).toEqual({ daysSinceOrder: 0, overdue: false });
  });

  it("is overdue one day past the cycle", () => {
    expect(orderStanding("2026-08-12", 30, "2026-09-12")).toEqual({ daysSinceOrder: 31, overdue: true });
  });

  it("is overdue, with no day count, for a customer that never ordered", () => {
    expect(orderStanding(null, 30, "2026-09-12")).toEqual({ daysSinceOrder: null, overdue: true });
  });
});

describe("formatDateShort", () => {
  it("writes day, Indonesian month abbreviation and year, without padding the day", () => {
    expect(formatDateShort("2026-08-22")).toBe("22 Agu 2026");
    expect(formatDateShort("2026-05-05")).toBe("5 Mei 2026");
  });

  it("has all twelve months right", () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDateShort(`2026-${String(i + 1).padStart(2, "0")}-01`));
    expect(months).toEqual([
      "1 Jan 2026", "1 Feb 2026", "1 Mar 2026", "1 Apr 2026", "1 Mei 2026", "1 Jun 2026",
      "1 Jul 2026", "1 Agu 2026", "1 Sep 2026", "1 Okt 2026", "1 Nov 2026", "1 Des 2026",
    ]);
  });
});

describe("the business calendar (Asia/Jakarta, UTC+7)", () => {
  it("todayIso is the Jakarta date, not the server's", () => {
    // 18:00 UTC on the 25th is already 01:00 on the 26th in Jakarta.
    expect(todayIso(new Date("2026-09-25T18:00:00Z"))).toBe("2026-09-26");
    expect(todayIso(new Date("2026-09-25T16:59:59Z"))).toBe("2026-09-25");
    expect(todayIso(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });

  it("nowIso is second-precision ISO-8601 UTC", () => {
    expect(nowIso(new Date("2026-09-26T08:15:00.789Z"))).toBe("2026-09-26T08:15:00Z");
  });
});
