import { describe, expect, it } from "vitest";

import {
  applyCustomerFilters,
  customerFiltersToParams,
  parseCustomerFilters,
  type CustomerFilterRow,
  type CustomerFilters,
} from "~/lib/list-filters/customer";

const empty: CustomerFilters = {
  q: "",
  trash: false,
  salesmanId: null,
  smTeam: false,
  standing: null,
  tipe: null,
  lastFrom: null,
  lastTo: null,
};

const rows: CustomerFilterRow[] = [
  {
    id: 1,
    nama: "Toko A",
    salesmanId: 10,
    tipeCustomer: "lama",
    orderCycleDays: 30,
    lastOrderDate: "2026-01-01",
    statusCustomer: "aktif",
  },
  {
    id: 2,
    nama: "Toko B",
    salesmanId: 20,
    tipeCustomer: "baru",
    orderCycleDays: 14,
    lastOrderDate: "2026-11-01",
    statusCustomer: "aktif",
  },
  {
    id: 3,
    nama: "Toko C",
    salesmanId: 10,
    tipeCustomer: "lama",
    orderCycleDays: 30,
    lastOrderDate: null,
    statusCustomer: "aktif",
  },
];

const salesmanNama = new Map([
  [10, "Andi"],
  [20, "Budi"],
]);

describe("parseCustomerFilters", () => {
  it("reads known params and ignores junk", () => {
    const params = new URLSearchParams(
      "sm=10&smTeam=1&standing=overdue&tipe=lama&lastFrom=2026-01-01&lastTo=2026-02-01&trash=1&q=Toko&standing=maybe",
    );
    expect(parseCustomerFilters(params)).toEqual({
      q: "toko",
      trash: true,
      salesmanId: 10,
      smTeam: true,
      standing: "overdue",
      tipe: "lama",
      lastFrom: "2026-01-01",
      lastTo: "2026-02-01",
    });
    expect(parseCustomerFilters(new URLSearchParams("sm=abc&standing=maybe")).salesmanId).toBeNull();
  });

  it("round-trips through customerFiltersToParams", () => {
    const filters: CustomerFilters = {
      q: "x",
      trash: true,
      salesmanId: 5,
      smTeam: true,
      standing: "on_track",
      tipe: "baru",
      lastFrom: "2026-03-01",
      lastTo: "2026-03-31",
    };
    expect(parseCustomerFilters(new URLSearchParams(customerFiltersToParams(filters)))).toEqual(
      filters,
    );
  });
});

describe("applyCustomerFilters", () => {
  it("filters by salesman set, tipe, standing, and last-order range", () => {
    const today = "2026-11-20";
    const filtered = applyCustomerFilters(
      rows,
      { ...empty, tipe: "lama", standing: "overdue" },
      { salesmanNama, allowedSalesmanIds: new Set([10]), today },
    );
    // Toko A: 323 days > 30 → overdue; Toko C: never ordered → overdue
    expect(filtered.map((r) => r.id)).toEqual([1, 3]);
  });

  it("excludes never-ordered rows when a last-order range is set", () => {
    const filtered = applyCustomerFilters(
      rows,
      { ...empty, lastFrom: "2026-01-01", lastTo: "2026-01-31" },
      { salesmanNama, allowedSalesmanIds: null },
    );
    expect(filtered.map((r) => r.id)).toEqual([1]);
  });

  it("matches q against customer or salesman name", () => {
    const filtered = applyCustomerFilters(
      rows,
      { ...empty, q: "budi" },
      { salesmanNama, allowedSalesmanIds: null },
    );
    expect(filtered.map((r) => r.id)).toEqual([2]);
  });
});
