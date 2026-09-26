import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigate } from "react-router";

import { PAGE_SIZE_OPTIONS } from "~/components/DataTable";

/** What the status filter needs to know: which view is open and how big each one is. */
export type StatusFilter = { trash: boolean; activeCount: number; trashCount: number };

const STATUS_VALUES = [
  { label: "Aktif", trash: false },
  { label: "Terhapus", trash: true },
] as const;

/**
 * The list search bar, after the design system: one bordered box holding the
 * search icon, the active filter as a chip ("Status adalah Terhapus ×"), the text
 * input and "Bersihkan"; focusing it opens a suggestion list to pick a filter.
 * State lives in the URL (`q`, `trash`, `pageSize`), so the server does the
 * filtering and the page stays linkable. Without `statusFilter` it is a plain
 * search box (the audit log has nothing to filter on yet).
 *
 * Enter searches every column; Backspace in the empty input removes the chip;
 * Escape closes the suggestions.
 */
export function TableToolbar({
  q,
  pageSize,
  hiddenFields,
  placeholder,
  statusFilter,
}: {
  q: string;
  pageSize: number;
  /** Params this list needs to keep on every link and search (e.g. `tab`). */
  hiddenFields: Record<string, string>;
  placeholder: string;
  statusFilter?: StatusFilter;
}) {
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(q);
  const [open, setOpen] = useState(false);
  const [choosingValue, setChoosingValue] = useState(false);
  useEffect(() => setDraft(q), [q]);

  const trash = statusFilter?.trash ?? false;
  /**
   * This list with the given status. Changing the filter keeps the search that was
   * already submitted (`q`) and drops text that is still being typed, as the design does
   * when a suggestion is picked.
   */
  const hrefFor = (opts: { trash: boolean; keepQuery: boolean }) => {
    const next = new URLSearchParams(hiddenFields);
    next.set("pageSize", String(pageSize));
    next.set("page", "1");
    if (opts.keepQuery && q) next.set("q", q);
    if (opts.trash) next.set("trash", "1");
    return `?${next}`;
  };
  const closePanel = () => {
    setOpen(false);
    setChoosingValue(false);
  };
  /** A filter or "Bersihkan" was chosen: the box goes back to the submitted search. */
  const resetDraft = (to: string) => {
    setDraft(to);
    closePanel();
  };

  // Suggestions follow what is being typed; the submitted search alone does not narrow them.
  const needle = draft.trim() === q ? "" : draft.trim().toLowerCase();
  const values = STATUS_VALUES.map((v) => ({
    ...v,
    hint: `${v.trash ? statusFilter?.trashCount : statusFilter?.activeCount} data`,
  }));
  const typedMatches = values.filter((v) => v.label.toLowerCase().includes(needle));
  const hasAnything = q !== "" || draft !== "" || trash;

  const valueRow = (v: (typeof values)[number], tag: string, label: string) => (
    <Link
      key={v.label}
      to={hrefFor({ trash: v.trash, keepQuery: true })}
      onClick={() => resetDraft(q)}
      className={`search-suggest__item${v.trash === trash ? " search-suggest__item--current" : ""}`}
    >
      <span className="search-suggest__tag">{tag}</span>
      <span className="search-suggest__label">{label}</span>
      <span className="search-suggest__hint">{v.hint}</span>
    </Link>
  );

  return (
    <>
      <Form method="get" className="table-toolbar">
        {Object.entries(hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="page" value="1" />
        {trash ? <input type="hidden" name="trash" value="1" /> : null}

        <div
          ref={wrap}
          className="search-wrap"
          onBlur={(e) => {
            if (!wrap.current?.contains(e.relatedTarget as Node | null)) closePanel();
          }}
        >
          <div className="search-bar">
            <span className="search-bar__icon" aria-hidden>
              ⌕
            </span>
            {trash ? (
              <span className="search-chip">
                <span className="search-chip__field">Status</span>
                <span className="search-chip__op">adalah</span>
                <span className="search-chip__value">Terhapus</span>
                <Link
                  to={hrefFor({ trash: false, keepQuery: true })}
                  className="search-chip__remove"
                  onClick={() => resetDraft(q)}
                  aria-label="Hapus filter Status Terhapus"
                >
                  ×
                </Link>
              </span>
            ) : null}
            <input
              className="search-bar__input"
              type="text"
              role="searchbox"
              name="q"
              value={draft}
              autoComplete="off"
              placeholder={placeholder}
              aria-label={placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closePanel();
                if (e.key === "Backspace" && draft === "" && trash) {
                  e.preventDefault();
                  // The input is empty, so the text query is empty too — keeping
                  // an old `q` would filter by text the bar no longer shows.
                  navigate(hrefFor({ trash: false, keepQuery: false }));
                }
              }}
            />
            {hasAnything ? (
              <Link
                to={hrefFor({ trash: false, keepQuery: false })}
                className="search-bar__clear"
                onClick={() => resetDraft("")}
              >
                Bersihkan
              </Link>
            ) : null}
          </div>

          {open && statusFilter ? (
            <div
              className="search-suggest"
              // Keep focus in the input while a suggestion is clicked.
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="search-suggest__head">
                <span>
                  {needle ? "SARAN" : choosingValue ? "NILAI STATUS" : "FILTER BERDASARKAN KOLOM"}
                </span>
                <span>Enter mencari</span>
              </div>
              {needle ? (
                <>
                  {typedMatches.map((v) => valueRow(v, "FILTER", `Status adalah ${v.label}`))}
                  <button type="submit" className="search-suggest__item">
                    <span className="search-suggest__tag">CARI</span>
                    <span className="search-suggest__label">Cari “{draft.trim()}” di semua kolom</span>
                    <span className="search-suggest__hint">Enter</span>
                  </button>
                </>
              ) : choosingValue ? (
                values.map((v) => valueRow(v, "STATUS", v.label))
              ) : (
                <button
                  type="button"
                  className="search-suggest__item"
                  onClick={() => setChoosingValue(true)}
                >
                  <span className="search-suggest__tag">FILTER</span>
                  <span className="search-suggest__label">Status adalah…</span>
                  <span className="search-suggest__hint">{values.length} nilai</span>
                </button>
              )}
            </div>
          ) : null}
        </div>

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
      {statusFilter ? (
        <p className="search-echo">
          {!trash && !q
            ? "Tanpa filter. Ketik untuk mencari di semua kolom, atau pilih kolom untuk difilter."
            : `Menampilkan data ${trash ? "terhapus" : "aktif"}${q ? ` yang mengandung “${q}” di kolom mana pun` : ""}.`}
        </p>
      ) : null}
    </>
  );
}
