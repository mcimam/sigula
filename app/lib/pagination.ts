/**
 * Which slice of `total` rows a page shows. The requested page is clamped into
 * range, so a stale link (page 9 of 3) lands on the last page instead of an empty one.
 * Plain module: the server pages in SQL with `offset`, the client-side lists slice with it.
 */
export function pageWindow(total: number, requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { page, totalPages, offset: (page - 1) * pageSize };
}

/** The page number in a query string: a positive integer, else 1. */
export function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
