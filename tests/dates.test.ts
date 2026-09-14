import { describe, expect, it } from "vitest";

import { daysSinceOrder, isOverdue } from "../app/lib/dates";

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
