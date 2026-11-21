import {
  applyCustomerFilters,
  withCustomerStanding,
  type CustomerFilters,
} from "~/lib/list-filters/customer";
import { subordinateIds, listLiveCustomers, listLiveSalesmen } from "~/lib/masterdata.server";
import { listDeletedCustomers } from "~/lib/trash.server";
import type { CustomerExportRow } from "~/lib/export.server";

/** Salesman id set for `sm` / `smTeam` (null = no salesman filter). */
export function allowedSalesmanIdsFor(filters: CustomerFilters): Set<number> | null {
  if (filters.salesmanId == null) return null;
  if (filters.smTeam) {
    return new Set([filters.salesmanId, ...subordinateIds(filters.salesmanId)]);
  }
  return new Set([filters.salesmanId]);
}

export function salesmanNamaMap() {
  return new Map(listLiveSalesmen().map((s) => [s.id, s.nama]));
}

/**
 * Live or trash customers after the same filters the Customer list applies.
 * Used by the list loader and by `/admin/export/customer`.
 */
export function filteredCustomers(filters: CustomerFilters) {
  const salesmanNama = salesmanNamaMap();
  const allowed = allowedSalesmanIdsFor(filters);
  const source = filters.trash ? listDeletedCustomers() : listLiveCustomers();
  return applyCustomerFilters(source, filters, {
    salesmanNama,
    allowedSalesmanIds: allowed,
  }).map((c) => {
    const standing = withCustomerStanding(c);
    const salesman =
      ("salesmanNama" in c && c.salesmanNama) ||
      salesmanNama.get(c.salesmanId) ||
      "—";
    return {
      ...standing,
      salesman: String(salesman),
    };
  });
}

export function toExportRows(
  rows: ReturnType<typeof filteredCustomers>,
): CustomerExportRow[] {
  return rows.map((c) => ({
    id: c.id,
    nama: c.nama,
    salesman: c.salesman,
    tipeCustomer: c.tipeCustomer,
    orderCycleDays: c.orderCycleDays,
    lastOrderDate: c.lastOrderDate,
    daysSinceOrder: c.daysSinceOrder,
    overdue: c.overdue,
    statusCustomer: c.statusCustomer,
    createdAt: c.createdAt,
  }));
}
