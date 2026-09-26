import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link, useLocation, useNavigate, useSearchParams } from "react-router";

import {
  ACTION_LABELS,
  fieldLabel,
  formatStamp,
  formatValue,
  type ActivityItem,
} from "~/lib/activity-format";

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

function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  return (
    <section className="drawer__activity" aria-labelledby="drawer-activity-title">
      <h3 id="drawer-activity-title" className="drawer__activity-title">
        Aktivitas
      </h3>
      {items.length === 0 ? (
        <p className="drawer__empty">Belum ada aktivitas tercatat untuk record ini.</p>
      ) : (
        <ol className="activity-list">
          {items.map((item) => (
            <li key={item.id} className={`activity-list__item activity-list__item--${item.action}`}>
              <div className="activity-list__head">
                <strong>{ACTION_LABELS[item.action]}</strong>
                <span> oleh {item.actorName || "sistem"}</span>
                <time className="activity-list__time">{formatStamp(item.createdAt)}</time>
              </div>
              <ul className="activity-list__changes">
                {Object.entries(item.changes).map(([key, change]) => (
                  <li key={key}>
                    <span className="activity-list__field">{fieldLabel(key)}</span>{" "}
                    {item.action === "update" ? (
                      <>
                        <s>{formatValue(change.from)}</s> → <b>{formatValue(change.to)}</b>
                      </>
                    ) : (
                      <b>{formatValue(item.action === "create" ? change.to : change.from)}</b>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RecordDrawer({
  title,
  subtitle,
  closeHref,
  submitLabel = "Simpan",
  activity,
  remove,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  submitLabel?: string;
  /** Existing records only — omit in create mode. */
  activity?: ActivityItem[];
  remove?: DrawerRemove;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
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
      ?.querySelector<HTMLElement>(".drawer__body input:not([type=hidden]), .drawer__body select")
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

  return (
    <div className="drawer-root">
      <Link
        to={closeHref}
        preventScrollReset
        className="drawer-backdrop"
        aria-label="Tutup panel"
        tabIndex={-1}
      />
      <aside
        ref={panelRef}
        className={`drawer${wide ? " drawer--wide" : ""}`}
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
                        <p>Hapus record ini? Tindakan tidak bisa dibatalkan.</p>
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
              aria-label={wide ? "Ciutkan panel" : "Perluas panel"}
              aria-pressed={wide}
              onClick={() => setWide((w) => !w)}
            >
              {wide ? "⤡" : "⤢"}
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
        <Form method="post" className="drawer__form">
          <div className="drawer__body">
            {children}
            {activity ? <ActivityTimeline items={activity} /> : null}
          </div>
          <footer className="drawer__footer">
            <Link to={closeHref} preventScrollReset className="btn btn-outline">
              Batal
            </Link>
            <button type="submit" className="btn">
              {submitLabel}
            </button>
          </footer>
        </Form>
      </aside>
    </div>
  );
}

export function EditLink({ href }: { href: string }) {
  return (
    <Link
      to={href}
      preventScrollReset
      className="btn btn-sm btn-outline"
      onClick={(e) => e.stopPropagation()}
    >
      Edit
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
