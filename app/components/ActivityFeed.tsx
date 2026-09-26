import { useEffect, useState } from "react";
import { Link, useFetcher, useLocation, useNavigate, useSearchParams } from "react-router";

import type { CommentEntity } from "~/lib/activity-entities";
import {
  COMMENT_MAX_LENGTH,
  FEED_PAGE_PARAM,
  fieldLabel,
  formatStamp,
  formatValue,
  initials,
  type ActivityItem,
  type FeedPage,
} from "~/lib/activity-format";

export type ActivityFeedProps = {
  feed: FeedPage;
  entityType: CommentEntity;
  entityId: number;
  /** Set on a late customer whose reason this user may give; adds the reason picker to the composer. */
  reasons?: { code: string; label: string }[];
};

/** What a log entry says, in the design system's one-line style ("Maya changed status from … to …"). */
function LogText({ item }: { item: ActivityItem }) {
  const actor = <strong>{item.actorName || "Sistem"}</strong>;
  if (item.action === "create") return <>{actor} membuat record ini</>;
  if (item.action === "delete") return <>{actor} menghapus record ini</>;
  if (item.action === "restore") return <>{actor} memulihkan record ini</>;

  const { alasan_keterlambatan: reason, ...others } = item.changes;
  const changed = Object.entries(others);
  return (
    <>
      {reason ? (
        <div>
          {actor} memberi alasan keterlambatan: <strong>{formatValue(reason.to)}</strong>
        </div>
      ) : null}
      {changed.length > 0 ? (
        <div>
          {actor} mengubah{" "}
          {changed.map(([key, c], i) => (
            <span key={key}>
              {i > 0 ? ", " : ""}
              {fieldLabel(key)} <s>{formatValue(c.from)}</s> → <b>{formatValue(c.to)}</b>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * "Aktivitas & komentar" (design system): a composer, then the record's log entries and
 * comments in one newest-first list, a page at a time. The composer posts to `/comments`
 * with a fetcher — a `<form>` here would nest inside the panel's own form. On a late
 * customer it also offers the reason picker: the reason is how a salesman answers a
 * reminder, and it appears in this list like any other log entry.
 */
export function ActivityFeed({ feed, entityType, entityId, reasons }: ActivityFeedProps) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");

  const busy = fetcher.state !== "idle";
  const posted = fetcher.state === "idle" && fetcher.data?.ok === true;
  const error = fetcher.state === "idle" && fetcher.data?.ok === false ? fetcher.data.error : null;

  // A message just sent is on page 1: go there, and empty the composer.
  useEffect(() => {
    if (!posted) return;
    setBody("");
    setReason("");
    if (params.has(FEED_PAGE_PARAM)) {
      const next = new URLSearchParams(params);
      next.delete(FEED_PAGE_PARAM);
      navigate(`${pathname}?${next}`, { replace: true, preventScrollReset: true });
    }
    // Only when a post finishes (`posted` turns true, after the list refreshed); `params`
    // changing while paging must not empty the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posted]);

  function send() {
    fetcher.submit(
      { entity_type: entityType, entity_id: String(entityId), body, kode_alasan: reason },
      { method: "post", action: "/comments" },
    );
  }

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams(params);
    if (page <= 1) next.delete(FEED_PAGE_PARAM);
    else next.set(FEED_PAGE_PARAM, String(page));
    return `${pathname}?${next}`;
  };

  return (
    <section className="drawer__activity feed" aria-labelledby="feed-title">
      <h3 id="feed-title" className="feed__title">
        Aktivitas &amp; komentar
      </h3>

      <div className="feed__composer">
        <span className="feed__avatar feed__avatar--you" aria-hidden>
          ANDA
        </span>
        <div className="feed__composer-main">
          {reasons && reasons.length > 0 ? (
            <select
              className="form-control"
              aria-label="Alasan keterlambatan"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Alasan keterlambatan (opsional)…</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : null}
          <textarea
            className="form-control feed__textarea"
            rows={2}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Tulis komentar…"
            aria-label="Tulis komentar"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error ? (
            <p className="feed__error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || (!body.trim() && !reason)}
            onClick={send}
          >
            {reason ? "Kirim alasan" : "Kirim komentar"}
          </button>
        </div>
      </div>

      {feed.entries.length === 0 ? (
        <p className="drawer__empty">Belum ada aktivitas atau komentar untuk record ini.</p>
      ) : (
        <ol className="feed__list">
          {feed.entries.map((entry) =>
            entry.kind === "comment" ? (
              <li key={`comment-${entry.item.id}`} className="feed__entry">
                <span className="feed__avatar feed__avatar--person" aria-hidden>
                  {initials(entry.item.authorName)}
                </span>
                <div className="feed__content">
                  <div className="feed__meta">
                    <strong>{entry.item.authorName || "Pengguna"}</strong>
                    <time>{formatStamp(entry.item.createdAt)}</time>
                  </div>
                  <p className="feed__body">{entry.item.body}</p>
                </div>
              </li>
            ) : (
              <li key={`log-${entry.item.id}`} className="feed__entry feed__entry--log">
                <span className="feed__avatar feed__avatar--log" aria-hidden>
                  {initials(entry.item.actorName)}
                </span>
                <div className="feed__content">
                  <LogText item={entry.item} />
                  <time className="feed__time">{formatStamp(entry.item.createdAt)}</time>
                </div>
              </li>
            ),
          )}
        </ol>
      )}

      {feed.totalPages > 1 ? (
        <nav className="feed__pager" aria-label="Halaman aktivitas">
          {feed.page > 1 ? (
            <Link to={hrefForPage(feed.page - 1)} preventScrollReset className="page-btn">
              ‹ Sebelumnya
            </Link>
          ) : (
            <span className="page-btn" aria-disabled="true">
              ‹ Sebelumnya
            </span>
          )}
          <span className="feed__pager-info">
            Halaman {feed.page} dari {feed.totalPages}
          </span>
          {feed.page < feed.totalPages ? (
            <Link to={hrefForPage(feed.page + 1)} preventScrollReset className="page-btn">
              Berikutnya ›
            </Link>
          ) : (
            <span className="page-btn" aria-disabled="true">
              Berikutnya ›
            </span>
          )}
        </nav>
      ) : null}
    </section>
  );
}
