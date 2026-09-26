import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { ActivityFeed, type ActivityFeedProps } from "~/components/ActivityFeed";

export type DrawerState = { mode: "new" } | { mode: "edit"; id: number } | null;

/**
 * The drawer's open/closed state lives in the URL (`?edit=<id>` or
 * `?edit=new`), so saving (the action redirects without it), closing, paging
 * and deep-linking all work without client state to keep in sync.
 */
export function parseDrawer(url: URL): DrawerState {
  const raw = url.searchParams.get("edit");
  if (raw === "new") return { mode: "new" };
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? { mode: "edit", id } : null;
}

export function useDrawerHref() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  return (target: number | "new" | null) => {
    const next = new URLSearchParams(params);
    next.delete("flash");
    if (target == null) next.delete("edit");
    else next.set("edit", String(target));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}

export type DrawerRemove = {
  /** Bulk-delete intent the route's action already understands. */
  intent: string;
  idName: string;
  id: number;
  /** When set, delete is shown but disabled with this explanation. */
  disabledReason?: string;
};

export function RecordDrawer({
  title,
  subtitle,
  closeHref,
  submitLabel = "Simpan",
  activity,
  remove,
  viewOnly = false,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  submitLabel?: string;
  /** Existing records only — omit in create mode. */
  activity?: ActivityFeedProps;
  remove?: DrawerRemove;
  /** A panel to read, not to edit: no form, no Simpan/Batal (e.g. a salesman's view of a customer). */
  viewOnly?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  function closeMenu() {
    setMenuOpen(false);
    setConfirming(false);
  }

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>(
        ".drawer__fields input:not([type=hidden]):not([readonly]), .drawer__fields select",
      )
      ?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Esc peels back one layer: an open menu first, then the drawer.
      if (menuOpenRef.current) closeMenu();
      else navigate(closeHref, { preventScrollReset: true });
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [closeHref, navigate]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".drawer__menu-wrap")) closeMenu();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Salin tautan ini:", window.location.href);
    }
    closeMenu();
  }

  const body = (
    <div className={`drawer__body${activity ? " drawer__body--split" : ""}`}>
      <div className="drawer__fields">{children}</div>
      {activity ? <ActivityFeed {...activity} /> : null}
    </div>
  );

  return (
    <div className="drawer-root">
      {/* Full page covers the screen, so there is nothing left to click on as a scrim. */}
      {full ? null : (
        <Link
          to={closeHref}
          preventScrollReset
          className="drawer-backdrop"
          aria-label="Tutup panel"
          tabIndex={-1}
        />
      )}
      <aside
        ref={panelRef}
        className={`drawer${full ? " drawer--full" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="drawer__header">
          <div className="drawer__heading">
            <h2 id="drawer-title" className="drawer__title">
              {title}
            </h2>
            {subtitle ? <p className="drawer__sub">{subtitle}</p> : null}
            {copied ? (
              <p className="drawer__toast" role="status">
                Tautan tersalin
              </p>
            ) : null}
          </div>
          <div className="drawer__actions">
            <div className="drawer__menu-wrap">
                <button
                  type="button"
                  className="drawer__icon-btn"
                  aria-label="Aksi lainnya"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                >
                  ⋮
                </button>
                {menuOpen ? (
                  <div className="drawer__menu" role="menu">
                    {confirming && remove ? (
                      <div className="drawer__confirm">
                        <p>Hapus record ini? Record masuk ke daftar Terhapus dan bisa dipulihkan.</p>
                        <div className="drawer__confirm-actions">
                          <Form method="post">
                            <input type="hidden" name="intent" value={remove.intent} />
                            <input type="hidden" name={remove.idName} value={remove.id} />
                            <button type="submit" className="btn btn-sm btn-danger">
                              Ya, hapus
                            </button>
                          </Form>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => setConfirming(false)}
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="drawer__menu-item"
                          onClick={copyLink}
                        >
                          Salin tautan
                        </button>
                        {remove ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="drawer__menu-item drawer__menu-item--danger"
                            disabled={!!remove.disabledReason}
                            title={remove.disabledReason}
                            onClick={() => setConfirming(true)}
                          >
                            Hapus record
                          </button>
                        ) : null}
                        {remove?.disabledReason ? (
                          <p className="drawer__menu-note">{remove.disabledReason}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
            </div>
            <button
              type="button"
              className="drawer__icon-btn"
              aria-label={full ? "Ciutkan ke panel samping" : "Perluas ke halaman penuh"}
              title={full ? "Ciutkan ke panel samping" : "Perluas ke halaman penuh"}
              aria-pressed={full}
              onClick={() => setFull((f) => !f)}
            >
              {full ? "⤡" : "⤢"}
            </button>
            <Link
              to={closeHref}
              preventScrollReset
              className="drawer__icon-btn"
              aria-label="Tutup panel"
            >
              ×
            </Link>
          </div>
        </header>
        {viewOnly ? (
          <div className="drawer__form">{body}</div>
        ) : (
          <Form method="post" className="drawer__form">
            {body}
            <footer className="drawer__footer">
              <Link to={closeHref} preventScrollReset className="btn btn-outline">
                Batal
              </Link>
              <button type="submit" className="btn">
                {submitLabel}
              </button>
            </footer>
          </Form>
        )}
      </aside>
    </div>
  );
}

/** A value shown among the form fields that the user cannot change (and that is not submitted). */
export function ReadonlyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="form-control" value={value} readOnly />
    </div>
  );
}

export function EditLink({ href, label = "Edit" }: { href: string; label?: string }) {
  return (
    <Link
      to={href}
      preventScrollReset
      className="btn btn-sm btn-outline"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}

export function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link to={href} preventScrollReset className="btn btn-sm">
      + {label}
    </Link>
  );
}

export function useRowOpen() {
  const navigate = useNavigate();
  return (href: string) => () => navigate(href, { preventScrollReset: true });
}
