import { Form } from "react-router";

import type { CustomerFilters } from "~/lib/list-filters/customer";

type SalesmanOption = { id: number; nama: string };

/**
 * Structured filters for the Customer admin list. Submits as GET so state
 * lives in the URL (`sm`, `smTeam`, `standing`, `tipe`, `lastFrom`, `lastTo`)
 * alongside `q` / `trash` / `pageSize` / `tab`.
 */
export function CustomerFilterBar({
  filters,
  salesmen,
  pageSize,
  hiddenFields,
}: {
  filters: CustomerFilters;
  salesmen: SalesmanOption[];
  pageSize: number;
  /** Params that must survive a filter submit (e.g. `tab`, `q`, `trash`). */
  hiddenFields: Record<string, string>;
}) {
  return (
    <Form method="get" className="list-filter-bar">
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="pageSize" value={String(pageSize)} />

      <label className="list-filter-bar__field">
        <span>Salesman</span>
        <select name="sm" defaultValue={filters.salesmanId ?? ""}>
          <option value="">Semua</option>
          {salesmen.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nama}
            </option>
          ))}
        </select>
      </label>

      <label className="list-filter-bar__check">
        <input
          type="checkbox"
          name="smTeam"
          value="1"
          defaultChecked={filters.smTeam}
        />
        <span>Seluruh tim</span>
      </label>

      <label className="list-filter-bar__field">
        <span>Status order</span>
        <select name="standing" defaultValue={filters.standing ?? ""}>
          <option value="">Semua</option>
          <option value="overdue">Overdue</option>
          <option value="on_track">On track</option>
        </select>
      </label>

      <label className="list-filter-bar__field">
        <span>Tipe</span>
        <select name="tipe" defaultValue={filters.tipe ?? ""}>
          <option value="">Semua</option>
          <option value="lama">Lama</option>
          <option value="baru">Baru</option>
        </select>
      </label>

      <label className="list-filter-bar__field">
        <span>Order dari</span>
        <input type="date" name="lastFrom" defaultValue={filters.lastFrom ?? ""} />
      </label>

      <label className="list-filter-bar__field">
        <span>Order sampai</span>
        <input type="date" name="lastTo" defaultValue={filters.lastTo ?? ""} />
      </label>

      <button type="submit" className="btn btn-sm">
        Terapkan
      </button>
      <a
        className="btn btn-sm btn-outline"
        href={`?${new URLSearchParams({
          ...hiddenFields,
          pageSize: String(pageSize),
          page: "1",
        }).toString()}`}
      >
        Reset filter
      </a>
    </Form>
  );
}
