import { listLiveCustomers, listLiveSalesmen } from "~/lib/masterdata.server";
import { listTransaksi } from "~/lib/orders.server";
import { listDeletedTransaksi } from "~/lib/trash.server";
import type { TransaksiExportRow } from "~/lib/export.server";

export type TransaksiListFilters = {
  q: string;
  trash: boolean;
};

/** Same enrichment + q filter the Transaksi list uses (live or Terhapus). */
export function filteredTransaksi(filters: TransaksiListFilters): TransaksiExportRow[] {
  const q = filters.q;
  const matches = (row: {
    customerNama: string;
    salesmanNama: string;
    catatan: string;
    tanggalOrder: string;
  }) =>
    !q ||
    [row.customerNama, row.salesmanNama, row.catatan, row.tanggalOrder]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));

  if (filters.trash) {
    return listDeletedTransaksi()
      .filter(matches)
      .map((t) => ({
        id: t.id,
        customer: t.customerNama,
        salesman: t.salesmanNama,
        tanggalOrder: t.tanggalOrder,
        sumber: t.sumber,
        catatan: t.catatan,
        createdAt: t.createdAt,
      }));
  }

  const customers = new Map(listLiveCustomers().map((c) => [c.id, c.nama]));
  const salesmen = new Map(listLiveSalesmen().map((s) => [s.id, s.nama]));
  return listTransaksi(2000)
    .map((t) => ({
      id: t.id,
      customerNama: customers.get(t.customerId) ?? `#${t.customerId}`,
      salesmanNama: salesmen.get(t.salesmanId) ?? `#${t.salesmanId}`,
      tanggalOrder: t.tanggalOrder,
      sumber: t.sumber,
      catatan: t.catatan,
      createdAt: t.createdAt,
      customerId: t.customerId,
      salesmanId: t.salesmanId,
    }))
    .filter(matches)
    .map((t) => ({
      id: t.id,
      customer: t.customerNama,
      salesman: t.salesmanNama,
      tanggalOrder: t.tanggalOrder,
      sumber: t.sumber,
      catatan: t.catatan,
      createdAt: t.createdAt,
    }));
}
