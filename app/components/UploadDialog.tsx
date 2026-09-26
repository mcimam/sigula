import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";

import { StatusPill } from "~/components/AppShell";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  UPLOAD_FIELD,
  UPLOAD_INTENT,
  type UploadActionData,
} from "~/lib/upload";

const PREVIEW_ROW_LIMIT = 100;

/**
 * What the dialog shows for one parsed file. The record builds it from its own
 * preview payload; the dialog owns all the layout.
 */
export type UploadPreviewView = {
  stats: {
    label: string;
    value: number;
    tone: "ok" | "warn" | "danger" | "muted";
  }[];
  columns: { header: string; hideOnMobile?: boolean }[];
  /** One array of cells per row, aligned with `columns`. */
  rows: ReactNode[][];
  /** Shown instead of the table when `rows` is empty. Confirm stays disabled. */
  emptyMessage: ReactNode;
  /**
   * Something the user must tick before confirming (e.g. "treat unknown sheets
   * as new"). Sent with the confirm request as `<field>=on`.
   */
  gate?: { field: string; notice: ReactNode; label: string };
};

export type UploadDialogProps<P, R> = {
  /** Trigger tooltip/aria-label and dialog heading, e.g. "Import dari Excel". */
  title: string;
  /** Subtitle while the user is still choosing a file. */
  description: string;
  /** Comma-separated extensions, e.g. ".xlsx". Checked in the browser too. */
  accept: string;
  maxBytes?: number;
  /** Route to post to; defaults to the current route's action. */
  action?: string;
  template?: { href: string; note: ReactNode; label?: string };
  confirmLabel?: string;
  describePreview: (preview: P) => UploadPreviewView;
  describeResult: (result: R) => ReactNode;
};

function UploadIcon() {
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
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

/**
 * Icon button that opens a drag-and-drop upload dialog: pick a file → preview
 * → confirm or cancel. It is record-agnostic; the route's action must speak
 * the protocol in `~/lib/upload` (use `handleUpload` from `upload.server`).
 * The dialog is mounted only while open, so every open starts with a fresh
 * fetcher and no stale preview.
 */
export function UploadButton<P, R>(props: UploadDialogProps<P, R>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline btn-icon"
        aria-label={props.title}
        title={props.title}
        onClick={() => setOpen(true)}
      >
        <UploadIcon />
      </button>
      {open ? <UploadDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function UploadDialog<P, R>({
  title,
  description,
  accept,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  action,
  template,
  confirmLabel = "Konfirmasi",
  describePreview,
  describeResult,
  onClose,
}: UploadDialogProps<P, R> & { onClose: () => void }) {
  const fetcher = useFetcher();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [gateChecked, setGateChecked] = useState(false);

  const data = fetcher.data as UploadActionData<P, R> | undefined;
  const busy = fetcher.state !== "idle";
  const stage = data?.result
    ? "done"
    : data?.preview && data.token
      ? "preview"
      : "select";
  const error = busy ? null : (clientError ?? data?.error ?? null);
  const extensions = accept
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const previewData = stage === "preview" ? data?.preview : undefined;
  const view = useMemo(
    () => (previewData ? describePreview(previewData) : null),
    [previewData, describePreview],
  );
  const gateBlocking = !!view?.gate && !gateChecked;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.close();
    };
  }, []);

  // Keep keyboard focus inside the dialog as the step changes (a disabled or
  // unmounted control would otherwise drop it back to the page behind).
  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>("[data-autofocus]")
      ?.focus();
  }, [stage]);

  function submit(fields: FormData | Record<string, string>, multipart = false) {
    fetcher.submit(fields, {
      method: "post",
      action,
      ...(multipart ? { encType: "multipart/form-data" as const } : {}),
    });
  }

  function requestClose() {
    // Closing mid-request would orphan the result (a confirm could still land).
    if (busy) return;
    if (stage === "preview" && data?.token) {
      // Best effort: the server drops the buffer; its 30 min TTL is the backstop.
      submit({
        intent: UPLOAD_INTENT.discard,
        [UPLOAD_FIELD.token]: data.token,
      });
    }
    onClose();
  }

  function pick(files: FileList | null | undefined) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setClientError("Unggah satu file saja.");
      return;
    }
    const file = files[0];
    if (!extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setClientError(`Format tidak didukung — gunakan file ${accept}.`);
      return;
    }
    if (file.size === 0) {
      setClientError("File kosong.");
      return;
    }
    if (file.size > maxBytes) {
      setClientError(
        `File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)} MB).`,
      );
      return;
    }
    setClientError(null);
    setFileName(file.name);
    setGateChecked(false);
    const form = new FormData();
    form.set("intent", UPLOAD_INTENT.preview);
    form.set(UPLOAD_FIELD.file, file);
    submit(form, true);
  }

  function confirm() {
    if (!data?.token) return;
    submit({
      intent: UPLOAD_INTENT.confirm,
      [UPLOAD_FIELD.token]: data.token,
      ...(view?.gate && gateChecked ? { [view.gate.field]: "on" } : {}),
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!busy) pick(e.dataTransfer.files);
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="upload-dialog"
      aria-labelledby="upload-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      // A file dropped outside the dropzone must not navigate the tab away.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <header className="upload-dialog__header">
        <div>
          <h2 id="upload-title" className="drawer__title">
            {title}
          </h2>
          <p className="drawer__sub">
            {stage === "preview"
              ? "Periksa dulu — belum ada data yang berubah."
              : stage === "done"
                ? "Selesai."
                : description}
          </p>
        </div>
        <button
          type="button"
          className="drawer__icon-btn"
          aria-label="Tutup"
          disabled={busy}
          onClick={requestClose}
        >
          ×
        </button>
      </header>

      <div className="upload-dialog__body">
        {error ? (
          <div className="alert alert-danger mb-4" role="alert">
            {error}
          </div>
        ) : null}

        {stage === "select" ? (
          <>
            <button
              type="button"
              data-autofocus
              className={`dropzone${dragging ? " dropzone--active" : ""}`}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <UploadIcon />
              {busy ? (
                <span className="dropzone__title" role="status">
                  Membaca {fileName ?? "file"}…
                </span>
              ) : (
                <>
                  <span className="dropzone__title">
                    Tarik &amp; lepas file {accept} ke sini
                  </span>
                  <span className="dropzone__hint">
                    atau klik untuk memilih file · maks{" "}
                    {Math.round(maxBytes / 1024 / 1024)} MB
                  </span>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
            />

            {template ? (
              <div className="upload-dialog__template">
                <p>{template.note}</p>
                <a
                  href={template.href}
                  download
                  className="btn btn-sm btn-outline"
                >
                  {template.label ?? "Unduh contoh template"}
                </a>
              </div>
            ) : null}
          </>
        ) : null}

        {view ? (
          <>
            <p className="upload-dialog__file">
              File: <b>{fileName}</b>
            </p>
            <div className="upload-dialog__stats">
              {view.stats.map((s) => (
                <StatusPill key={s.label} tone={s.tone}>
                  {s.label} {s.value}
                </StatusPill>
              ))}
            </div>

            {view.gate ? (
              <div className="alert alert-warn mb-4">
                <div className="mb-2">{view.gate.notice}</div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={gateChecked}
                    disabled={busy}
                    onChange={(e) => setGateChecked(e.target.checked)}
                  />
                  {view.gate.label}
                </label>
              </div>
            ) : null}

            {view.rows.length === 0 ? (
              <div className="alert alert-warn">{view.emptyMessage}</div>
            ) : (
              <div className="table-wrap upload-dialog__table">
                <table className="data">
                  <thead>
                    <tr>
                      {view.columns.map((c, i) => (
                        <th key={i} className={c.hideOnMobile ? "hide-sm" : undefined}>
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.slice(0, PREVIEW_ROW_LIMIT).map((cells, i) => (
                      <tr key={i}>
                        {cells.map((cell, j) => (
                          <td
                            key={j}
                            className={
                              view.columns[j]?.hideOnMobile ? "hide-sm" : undefined
                            }
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {view.rows.length > PREVIEW_ROW_LIMIT ? (
              <p className="upload-dialog__more">
                +{view.rows.length - PREVIEW_ROW_LIMIT} baris lain tidak
                ditampilkan (tetap ikut diproses).
              </p>
            ) : null}
          </>
        ) : null}

        {stage === "done" && data?.result ? (
          <div className="alert alert-ok" role="status">
            {describeResult(data.result)}
          </div>
        ) : null}
      </div>

      <footer className="upload-dialog__footer">
        {stage === "done" ? (
          <button
            type="button"
            className="btn"
            data-autofocus
            onClick={requestClose}
          >
            Selesai
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline"
              data-autofocus={stage === "preview" ? true : undefined}
              disabled={busy}
              onClick={requestClose}
            >
              Batal
            </button>
            {stage === "preview" ? (
              <button
                type="button"
                className="btn"
                disabled={busy || !view || view.rows.length === 0 || gateBlocking}
                onClick={confirm}
              >
                {busy ? "Memproses…" : confirmLabel}
              </button>
            ) : null}
          </>
        )}
      </footer>
    </dialog>
  );
}
