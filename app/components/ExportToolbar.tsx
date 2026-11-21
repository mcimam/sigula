import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  AUDIT_EXPORT_SECTIONS,
  AUDIT_SECTION_COLUMNS,
  auditStorageKey,
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_EXPORT_STORAGE_KEY,
  DEFAULT_CUSTOMER_EXPORT_COLUMNS,
  DEFAULT_SALESMAN_EXPORT_COLUMNS,
  DEFAULT_TRANSAKSI_EXPORT_COLUMNS,
  DEFAULT_USER_EXPORT_COLUMNS,
  resolveAuditColumns,
  resolveCustomerColumns,
  resolveSalesmanColumns,
  resolveTransaksiColumns,
  resolveUserColumns,
  SALESMAN_EXPORT_COLUMNS,
  SALESMAN_EXPORT_STORAGE_KEY,
  sanitizeExportBasename,
  TRANSAKSI_EXPORT_COLUMNS,
  TRANSAKSI_EXPORT_STORAGE_KEY,
  USER_EXPORT_COLUMNS,
  USER_EXPORT_STORAGE_KEY,
  type AuditExportSection,
  type CustomerExportColumnKey,
  type SalesmanExportColumnKey,
  type TransaksiExportColumnKey,
  type UserExportColumnKey,
} from "~/lib/export-columns";
import { customerFiltersToParams, type CustomerFilters } from "~/lib/list-filters/customer";

function DownloadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

type ColumnDef = { key: string; label: string };

type ExportDialogProps = {
  open: boolean;
  columns: readonly ColumnDef[];
  storageKey: string;
  defaultKeys: string[];
  resolveKeys: (raw: string[] | null | undefined) => string[];
  exportPath: string;
  filterParams: Record<string, string>;
  selectedIds?: number[];
  defaultFileName: string;
  onClose: () => void;
  /** Optional section picker (Log Audit). */
  sectionControl?: {
    value: string;
    options: readonly { key: string; label: string }[];
    onChange: (key: string) => void;
  };
};

function readStoredKeys(storageKey: string, resolveKeys: ExportDialogProps["resolveKeys"]) {
  if (typeof window === "undefined") return resolveKeys(null);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return resolveKeys(null);
    return resolveKeys(JSON.parse(raw) as string[]);
  } catch {
    return resolveKeys(null);
  }
}

function ExportDialog({
  open,
  columns,
  storageKey,
  defaultKeys,
  resolveKeys,
  exportPath,
  filterParams,
  selectedIds,
  defaultFileName,
  onClose,
  sectionControl,
}: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const skipNativeClose = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [fileName, setFileName] = useState(defaultFileName);
  const [cols, setCols] = useState<string[]>(() => [...defaultKeys]);
  const [columnQuery, setColumnQuery] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setFileName(defaultFileName);
    setCols(readStoredKeys(storageKey, resolveKeys));
    setColumnQuery("");
  }, [open, defaultFileName, storageKey, resolveKeys]);

  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
    if (dialog.open) {
      skipNativeClose.current = true;
      dialog.close();
      skipNativeClose.current = false;
    }
  }, [open, mounted]);

  const filteredColumns = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter(
      (c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q),
    );
  }, [columnQuery, columns]);

  const allKeys = columns.map((c) => c.key);
  const allSelected = allKeys.every((k) => cols.includes(k));
  const someSelected = allKeys.some((k) => cols.includes(k));
  const canExport = cols.length > 0 && sanitizeExportBasename(fileName).length > 0;

  const persist = (keys: string[]) => {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  };

  const toggle = (key: string) => {
    setCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const resolved = resolveKeys(next);
      persist(resolved);
      return resolved;
    });
  };

  const toggleAll = (checked: boolean) => {
    const next = checked ? [...defaultKeys] : [];
    persist(next);
    setCols(next);
  };

  const basename = sanitizeExportBasename(fileName);
  const isSelected = (selectedIds?.length ?? 0) > 0;

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="export-dialog"
      onClose={() => {
        if (skipNativeClose.current) return;
        onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <header className="export-dialog__header">
        <h2>Export</h2>
        <button
          type="button"
          className="btn btn-sm btn-outline btn-icon"
          aria-label="Tutup"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="export-dialog__body">
        <label className="export-dialog__field">
          <span>File name</span>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            data-autofocus
            autoComplete="off"
          />
        </label>

        <label className="export-dialog__field">
          <span>Export as</span>
          <select defaultValue="xlsx" disabled>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
        </label>

        {sectionControl ? (
          <label className="export-dialog__field">
            <span>Bagian</span>
            <select
              value={sectionControl.value}
              onChange={(e) => sectionControl.onChange(e.target.value)}
            >
              {sectionControl.options.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="export-dialog__field">
          <span>Select columns</span>
          <div className="export-dialog__columns">
            <div className="export-dialog__columns-toolbar">
              <input
                type="checkbox"
                aria-label="Pilih semua kolom"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              <div className="export-dialog__search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Search"
                  value={columnQuery}
                  onChange={(e) => setColumnQuery(e.target.value)}
                />
              </div>
            </div>
            <ul className="export-dialog__column-list">
              {filteredColumns.length === 0 ? (
                <li className="export-dialog__empty">Tidak ada kolom yang cocok.</li>
              ) : (
                filteredColumns.map((c) => (
                  <li key={c.key}>
                    <label className="export-dialog__col">
                      <input
                        type="checkbox"
                        checked={cols.includes(c.key)}
                        onChange={() => toggle(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>

      <footer className="export-dialog__footer">
        <iframe name="export-download" title="Download" className="export-dialog__sink" />
        {isSelected ? (
          <form
            method="post"
            action={exportPath}
            target="export-download"
            onSubmit={() => {
              if (canExport) onClose();
            }}
          >
            {Object.entries(filterParams).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <input type="hidden" name="cols" value={cols.join(",")} />
            <input type="hidden" name="filename" value={basename} />
            {selectedIds!.map((id) => (
              <input key={id} type="hidden" name="id" value={id} />
            ))}
            <button type="submit" className="btn" disabled={!canExport}>
              Export
            </button>
          </form>
        ) : canExport ? (
          <a
            className="btn"
            href={`${exportPath}?${new URLSearchParams({
              ...filterParams,
              cols: cols.join(","),
              filename: basename,
            }).toString()}`}
            onClick={() => onClose()}
          >
            Export
          </a>
        ) : (
          <button type="button" className="btn" disabled>
            Export
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancel
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

function ExportIconTrigger({
  open,
  onOpen,
  dialog,
}: {
  open: boolean;
  onOpen: () => void;
  dialog: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline btn-icon export-toolbar__open"
        aria-label="Export ke Excel"
        title="Export ke Excel"
        aria-expanded={open}
        onClick={onOpen}
      >
        <DownloadIcon />
      </button>
      {dialog}
    </>
  );
}

/** Customer list: icon opens the export dialog. */
export function CustomerExportToolbar({ filters }: { filters: CustomerFilters }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-toolbar">
      <ExportIconTrigger
        open={open}
        onOpen={() => setOpen(true)}
        dialog={
          <ExportDialog
            open={open}
            columns={CUSTOMER_EXPORT_COLUMNS}
            storageKey={CUSTOMER_EXPORT_STORAGE_KEY}
            defaultKeys={[...DEFAULT_CUSTOMER_EXPORT_COLUMNS]}
            resolveKeys={(raw) => resolveCustomerColumns(raw as CustomerExportColumnKey[] | null)}
            exportPath="/admin/export/customer"
            filterParams={customerFiltersToParams(filters)}
            defaultFileName="Customer"
            onClose={() => setOpen(false)}
          />
        }
      />
    </div>
  );
}

/** Customer bulk bar: Export terpilih still opens the same dialog. */
export function CustomerExportSelected({
  ids,
  filters,
}: {
  ids: number[];
  filters: CustomerFilters;
}) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        onClick={() => setOpen(true)}
      >
        Export terpilih
      </button>
      <ExportDialog
        open={open}
        columns={CUSTOMER_EXPORT_COLUMNS}
        storageKey={CUSTOMER_EXPORT_STORAGE_KEY}
        defaultKeys={[...DEFAULT_CUSTOMER_EXPORT_COLUMNS]}
        resolveKeys={(raw) => resolveCustomerColumns(raw as CustomerExportColumnKey[] | null)}
        exportPath="/admin/export/customer"
        filterParams={customerFiltersToParams(filters)}
        selectedIds={ids}
        defaultFileName={`Customer (${ids.length} terpilih)`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** Transaksi toolbar: icon beside Import. */
export function TransaksiExportToolbar({
  q,
  trash,
}: {
  q: string;
  trash: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filterParams: Record<string, string> = {};
  if (q) filterParams.q = q;
  if (trash) filterParams.trash = "1";

  return (
    <ExportIconTrigger
      open={open}
      onOpen={() => setOpen(true)}
      dialog={
        <ExportDialog
          open={open}
          columns={TRANSAKSI_EXPORT_COLUMNS}
          storageKey={TRANSAKSI_EXPORT_STORAGE_KEY}
          defaultKeys={[...DEFAULT_TRANSAKSI_EXPORT_COLUMNS]}
          resolveKeys={(raw) => resolveTransaksiColumns(raw as TransaksiExportColumnKey[] | null)}
          exportPath="/admin/export/transaksi"
          filterParams={filterParams}
          defaultFileName="Transaksi"
          onClose={() => setOpen(false)}
        />
      }
    />
  );
}

/** Transaksi bulk bar: Export terpilih. */
export function TransaksiExportSelected({
  ids,
  q,
  trash,
}: {
  ids: number[];
  q: string;
  trash: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return null;
  const filterParams: Record<string, string> = {};
  if (q) filterParams.q = q;
  if (trash) filterParams.trash = "1";

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        onClick={() => setOpen(true)}
      >
        Export terpilih
      </button>
      <ExportDialog
        open={open}
        columns={TRANSAKSI_EXPORT_COLUMNS}
        storageKey={TRANSAKSI_EXPORT_STORAGE_KEY}
        defaultKeys={[...DEFAULT_TRANSAKSI_EXPORT_COLUMNS]}
        resolveKeys={(raw) => resolveTransaksiColumns(raw as TransaksiExportColumnKey[] | null)}
        exportPath="/admin/export/transaksi"
        filterParams={filterParams}
        selectedIds={ids}
        defaultFileName={`Transaksi (${ids.length} terpilih)`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function masterFilterParams(q: string, trash: boolean) {
  const filterParams: Record<string, string> = {};
  if (q) filterParams.q = q;
  if (trash) filterParams.trash = "1";
  return filterParams;
}

/** Salesman toolbar: icon beside Tambah. */
export function SalesmanExportToolbar({ q, trash }: { q: string; trash: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <ExportIconTrigger
      open={open}
      onOpen={() => setOpen(true)}
      dialog={
        <ExportDialog
          open={open}
          columns={SALESMAN_EXPORT_COLUMNS}
          storageKey={SALESMAN_EXPORT_STORAGE_KEY}
          defaultKeys={[...DEFAULT_SALESMAN_EXPORT_COLUMNS]}
          resolveKeys={(raw) => resolveSalesmanColumns(raw as SalesmanExportColumnKey[] | null)}
          exportPath="/admin/export/salesman"
          filterParams={masterFilterParams(q, trash)}
          defaultFileName="Salesman"
          onClose={() => setOpen(false)}
        />
      }
    />
  );
}

/** Salesman bulk bar: Export terpilih. */
export function SalesmanExportSelected({
  ids,
  q,
  trash,
}: {
  ids: number[];
  q: string;
  trash: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => setOpen(true)}>
        Export terpilih
      </button>
      <ExportDialog
        open={open}
        columns={SALESMAN_EXPORT_COLUMNS}
        storageKey={SALESMAN_EXPORT_STORAGE_KEY}
        defaultKeys={[...DEFAULT_SALESMAN_EXPORT_COLUMNS]}
        resolveKeys={(raw) => resolveSalesmanColumns(raw as SalesmanExportColumnKey[] | null)}
        exportPath="/admin/export/salesman"
        filterParams={masterFilterParams(q, trash)}
        selectedIds={ids}
        defaultFileName={`Salesman (${ids.length} terpilih)`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** User toolbar: icon beside Tambah. */
export function UserExportToolbar({ q, trash }: { q: string; trash: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <ExportIconTrigger
      open={open}
      onOpen={() => setOpen(true)}
      dialog={
        <ExportDialog
          open={open}
          columns={USER_EXPORT_COLUMNS}
          storageKey={USER_EXPORT_STORAGE_KEY}
          defaultKeys={[...DEFAULT_USER_EXPORT_COLUMNS]}
          resolveKeys={(raw) => resolveUserColumns(raw as UserExportColumnKey[] | null)}
          exportPath="/admin/export/user"
          filterParams={masterFilterParams(q, trash)}
          defaultFileName="User"
          onClose={() => setOpen(false)}
        />
      }
    />
  );
}

/** User bulk bar: Export terpilih. */
export function UserExportSelected({
  ids,
  q,
  trash,
}: {
  ids: number[];
  q: string;
  trash: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => setOpen(true)}>
        Export terpilih
      </button>
      <ExportDialog
        open={open}
        columns={USER_EXPORT_COLUMNS}
        storageKey={USER_EXPORT_STORAGE_KEY}
        defaultKeys={[...DEFAULT_USER_EXPORT_COLUMNS]}
        resolveKeys={(raw) => resolveUserColumns(raw as UserExportColumnKey[] | null)}
        exportPath="/admin/export/user"
        filterParams={masterFilterParams(q, trash)}
        selectedIds={ids}
        defaultFileName={`User (${ids.length} terpilih)`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** Log Audit: one dialog with section picker + current activity filters. */
export function AuditExportToolbar({ q, entity }: { q: string; entity: string }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AuditExportSection>("activity");
  const columns = AUDIT_SECTION_COLUMNS[section];
  const storageKey = auditStorageKey(section);
  const defaultKeys = columns.map((c) => c.key);
  const sectionLabel =
    AUDIT_EXPORT_SECTIONS.find((s) => s.key === section)?.label ?? section;
  const filterParams: Record<string, string> = { section };
  if (q) filterParams.q = q;
  if (entity) filterParams.entity = entity;

  return (
    <ExportIconTrigger
      open={open}
      onOpen={() => setOpen(true)}
      dialog={
        <ExportDialog
          open={open}
          columns={columns}
          storageKey={storageKey}
          defaultKeys={defaultKeys}
          resolveKeys={(raw) => resolveAuditColumns(section, raw)}
          exportPath="/admin/export/audit"
          filterParams={filterParams}
          defaultFileName={sectionLabel}
          onClose={() => setOpen(false)}
          sectionControl={{
            value: section,
            options: AUDIT_EXPORT_SECTIONS,
            onChange: (key) => setSection(key as AuditExportSection),
          }}
        />
      }
    />
  );
}
