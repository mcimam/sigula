import { describe, expect, it } from "vitest";

import { pageWindow, parsePage } from "~/lib/pagination";

describe("pageWindow", () => {
  it("slices the requested page", () => {
    expect(pageWindow(25, 2, 10)).toEqual({ page: 2, totalPages: 3, offset: 10 });
  });

  it("clamps a stale page number into range", () => {
    expect(pageWindow(25, 9, 10)).toEqual({ page: 3, totalPages: 3, offset: 20 });
    expect(pageWindow(25, 0, 10)).toEqual({ page: 1, totalPages: 3, offset: 0 });
  });

  it("an empty list is one empty page, not zero pages", () => {
    expect(pageWindow(0, 1, 10)).toEqual({ page: 1, totalPages: 1, offset: 0 });
  });

  it("a full last page does not create an extra one", () => {
    expect(pageWindow(20, 2, 10)).toEqual({ page: 2, totalPages: 2, offset: 10 });
    expect(pageWindow(21, 3, 10).totalPages).toBe(3);
  });
});

describe("parsePage", () => {
  it("reads a positive integer and falls back to 1 for anything else", () => {
    expect(parsePage("3")).toBe(3);
    for (const bad of [null, "", "0", "-2", "1.5", "abc"]) expect(parsePage(bad), String(bad)).toBe(1);
  });
});
