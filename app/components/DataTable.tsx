import { useEffect, useState } from "react";
import { Form, Link } from "react-router";

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;

export function resolvePageSize(raw: string | null): number {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export function paginate<T>(rows: T[], requestedPage: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, totalPages, page, pageSize };
}

/**
 * Selection is derived against `ids` (the current page's rows) on every
 * render, so ids removed by a bulk/individual delete disappear from the
 * count immediately even when the redirect lands back on the same
 * page/q/pageSize (the route component isn't remounted, so the effect
 * below won't fire — the derivation is what actually keeps this correct).
 */
export function useRowSelection(ids: number[], resetKey: string) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  const visible = new Set(ids);
  const effective = new Set([...selected].filter((id) => visible.has(id)));

  return {
    selected: effective,
    toggleAll(checked: boolean) {
      setSelected(checked ? new Set(ids) : new Set());
    },
    toggleOne(id: number, checked: boolean) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    clear() {
      setSelected(new Set());
    },
    allChecked: ids.length > 0 && ids.every((id) => effective.has(id)),
    someChecked: ids.some((id) => effective.has(id)),
  };
}

export function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label="Pilih semua di halaman ini"
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function BulkActionBar({
  count,
  intent,
  idName,
  ids,
  onClear,
}: {
  count: number;
  intent: string;
  idName: string;
  ids: number[];
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar">
      <span>{count} dipilih</span>
      <Form method="post">
        <input type="hidden" name="intent" value={intent} />
        {ids.map((id) => (
          <input key={id} type="hidden" name={idName} value={id} />
        ))}
        <button type="submit" className="btn btn-sm btn-danger">
          Hapus terpilih
        </button>
      </Form>
      <button type="button" className="btn btn-sm btn-outline" onClick={onClear}>
        Batalkan pilihan
      </button>
    </div>
  );
}

export function TableToolbar({
  q,
  pageSize,
  hiddenFields,
  placeholder,
}: {
  q: string;
  pageSize: number;
  hiddenFields: Record<string, string>;
  placeholder: string;
}) {
  return (
    <Form method="get" className="table-toolbar">
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="page" value="1" />
      <input
        className="form-control table-toolbar__search"
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <label className="table-toolbar__pagesize">
        Rows
        <select
          name="pageSize"
          className="form-control"
          defaultValue={pageSize}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </Form>
  );
}

export function TablePagination({
  page,
  pageSize,
  totalPages,
  total,
  hrefForPage,
  hiddenFields,
  emptyLabel = "0 data",
}: {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  hrefForPage: (page: number) => string;
  hiddenFields: Record<string, string>;
  emptyLabel?: string;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageWindow = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    const first = Math.max(1, Math.min(page - 2, totalPages - 4));
    return first + i;
  });

  return (
    <div className="table-pagination">
      <span>{total === 0 ? emptyLabel : `Records ${start}–${end} of ${total}`}</span>
      <div className="table-pagination__pages">
        <Link
          className="page-btn"
          aria-disabled={page <= 1}
          to={hrefForPage(Math.max(1, page - 1))}
        >
          ‹ Prev
        </Link>
        {pageWindow.map((p) => (
          <Link
            key={p}
            className="page-btn"
            aria-current={p === page ? "page" : undefined}
            to={hrefForPage(p)}
          >
            {p}
          </Link>
        ))}
        <Link
          className="page-btn"
          aria-disabled={page >= totalPages}
          to={hrefForPage(Math.min(totalPages, page + 1))}
        >
          Next ›
        </Link>
      </div>
      <Form method="get" className="table-pagination__goto">
        {Object.entries(hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor="goto-page">Go to</label>
        <input
          id="goto-page"
          type="number"
          name="page"
          min={1}
          max={totalPages}
          defaultValue={page}
        />
        <button type="submit" className="btn btn-sm btn-outline">
          Go
        </button>
      </Form>
    </div>
  );
}
