import { isOverdue, orderStanding, todayIso } from "~/lib/dates";

export type CustomerStandingFilter = "overdue" | "on_track";
export type CustomerTipeFilter = "lama" | "baru";

/** Structured Customer list filters — mirrored in the URL (ADR-0010 / FR-E1…3). */
export type CustomerFilters = {
  q: string;
  trash: boolean;
  salesmanId: number | null;
  smTeam: boolean;
  standing: CustomerStandingFilter | null;
  tipe: CustomerTipeFilter | null;
  lastFrom: string | null;
  lastTo: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDay(raw: string | null): string | null {
  if (!raw || !ISO_DATE.test(raw)) return null;
  return raw;
}

function parseStanding(raw: string | null): CustomerStandingFilter | null {
  if (raw === "overdue" || raw === "on_track") return raw;
  return null;
}

function parseTipe(raw: string | null): CustomerTipeFilter | null {
  if (raw === "lama" || raw === "baru") return raw;
  return null;
}

/** Read Customer filters from a URL (or form) search params. Invalid values are ignored. */
export function parseCustomerFilters(params: URLSearchParams): CustomerFilters {
  const smRaw = params.get("sm");
  const sm = smRaw ? Number(smRaw) : NaN;
  return {
    q: params.get("q")?.trim().toLowerCase() ?? "",
    trash: params.get("trash") === "1",
    salesmanId: Number.isInteger(sm) && sm > 0 ? sm : null,
    smTeam: params.get("smTeam") === "1",
    standing: parseStanding(params.get("standing")),
    tipe: parseTipe(params.get("tipe")),
    lastFrom: parseIsoDay(params.get("lastFrom")),
    lastTo: parseIsoDay(params.get("lastTo")),
  };
}

/** Params to keep on list links / export (omit empties). */
export function customerFiltersToParams(filters: CustomerFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.q) out.q = filters.q;
  if (filters.trash) out.trash = "1";
  if (filters.salesmanId != null) out.sm = String(filters.salesmanId);
  if (filters.smTeam && filters.salesmanId != null) out.smTeam = "1";
  if (filters.standing) out.standing = filters.standing;
  if (filters.tipe) out.tipe = filters.tipe;
  if (filters.lastFrom) out.lastFrom = filters.lastFrom;
  if (filters.lastTo) out.lastTo = filters.lastTo;
  return out;
}

export type CustomerFilterRow = {
  id: number;
  nama: string;
  salesmanId: number;
  tipeCustomer: "lama" | "baru" | string;
  orderCycleDays: number;
  lastOrderDate: string | null;
  statusCustomer: string;
  /** Present on trash rows; used for `q` when live salesman map is incomplete. */
  salesmanNama?: string | null;
};

/**
 * Apply structured filters (+ `q`) to customer rows. `allowedSalesmanIds` is the
 * precomputed set for `sm` / `smTeam` (exact id, or self + subordinates).
 */
export function applyCustomerFilters<T extends CustomerFilterRow>(
  rows: T[],
  filters: CustomerFilters,
  opts: {
    salesmanNama: Map<number, string>;
    allowedSalesmanIds: Set<number> | null;
    today?: string;
  },
): T[] {
  const today = opts.today ?? todayIso();
  return rows.filter((c) => {
    if (filters.q) {
      const sm =
        c.salesmanNama ?? opts.salesmanNama.get(c.salesmanId) ?? "";
      if (
        !c.nama.toLowerCase().includes(filters.q) &&
        !sm.toLowerCase().includes(filters.q)
      ) {
        return false;
      }
    }
    if (opts.allowedSalesmanIds && !opts.allowedSalesmanIds.has(c.salesmanId)) {
      return false;
    }
    if (filters.tipe && c.tipeCustomer !== filters.tipe) return false;
    if (filters.standing) {
      const overdue = isOverdue(c.lastOrderDate, c.orderCycleDays, today);
      if (filters.standing === "overdue" && !overdue) return false;
      if (filters.standing === "on_track" && overdue) return false;
    }
    if (filters.lastFrom || filters.lastTo) {
      if (!c.lastOrderDate) return false;
      if (filters.lastFrom && c.lastOrderDate < filters.lastFrom) return false;
      if (filters.lastTo && c.lastOrderDate > filters.lastTo) return false;
    }
    return true;
  });
}

/** Standing fields for list/export rows (BR-1 at read time). */
export function withCustomerStanding<
  T extends { lastOrderDate: string | null; orderCycleDays: number },
>(row: T, today = todayIso()) {
  return { ...row, ...orderStanding(row.lastOrderDate, row.orderCycleDays, today) };
}
