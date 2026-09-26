import type { ReactNode } from "react";
import { Form } from "react-router";

import {
  BulkActionBar,
  SelectAllCheckbox,
  TablePagination,
  useRowSelection,
  type paginate,
} from "~/components/DataTable";
import { formatStamp } from "~/lib/activity-format";

export type TrashColumn<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  hideOnMobile?: boolean;
};

/**
 * The "Terhapus" view of a list (ADR-0005): read-only rows, a per-row and a
 * bulk "Pulihkan", and the same pagination as the live list. The route's
 * action owns what restoring means; this only posts `intent` + `idName`.
 */
export function TrashTable<T extends { id: number; deletedAt: string | null }>({
  table,
  columns,
  intent,
  idName,
  noun,
  resetKey,
  hrefForPage,
  hiddenFields,
  q,
}: {
  table: ReturnType<typeof paginate<T>>;
  columns: TrashColumn<T>[];
  /** Bulk-restore intent; posted with repeated `idName` fields. */
  intent: string;
  idName: string;
  noun: string;
  resetKey: string;
  hrefForPage: (page: number) => string;
  hiddenFields: Record<string, string>;
  q: string;
}) {
  const selection = useRowSelection(
    table.rows.map((r) => r.id),
    resetKey,
  );
  const colSpan = columns.length + 3;

  return (
    <>
      <BulkActionBar
        count={selection.selected.size}
        intent={intent}
        idName={idName}
        ids={[...selection.selected]}
        onClear={selection.clear}
        variant="restore"
      />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="checkbox-col">
                <SelectAllCheckbox
                  checked={selection.allChecked}
                  indeterminate={selection.someChecked && !selection.allChecked}
                  disabled={table.rows.length === 0}
                  onChange={selection.toggleAll}
                />
              </th>
              {columns.map((c) => (
                <th key={c.header} className={c.hideOnMobile ? "hide-sm" : undefined}>
                  {c.header}
                </th>
              ))}
              <th className="hide-sm">Dihapus</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="text-slate-500">
                  {q ? `Tidak ada ${noun} terhapus yang cocok.` : `Tidak ada ${noun} yang terhapus.`}
                </td>
              </tr>
            ) : (
              table.rows.map((row) => (
                <tr key={row.id}>
                  <td className="align-top">
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${noun} #${row.id}`}
                      checked={selection.selected.has(row.id)}
                      onChange={(e) => selection.toggleOne(row.id, e.target.checked)}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.header} className={`align-top${c.hideOnMobile ? " hide-sm" : ""}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                  <td className="align-top hide-sm text-slate-500">
                    {row.deletedAt ? formatStamp(row.deletedAt) : "—"}
                  </td>
                  <td className="align-top">
                    <Form method="post">
                      <input type="hidden" name="intent" value={intent} />
                      <input type="hidden" name={idName} value={row.id} />
                      <button type="submit" className="btn btn-sm btn-outline">
                        Pulihkan
                      </button>
                    </Form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          totalPages={table.totalPages}
          total={table.total}
          hrefForPage={hrefForPage}
          hiddenFields={hiddenFields}
          emptyLabel={`0 ${noun} terhapus`}
        />
      </div>
    </>
  );
}
