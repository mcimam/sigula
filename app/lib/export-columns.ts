/**
 * Column catalogue for admin list Excel export. Plain module so the column
 * picker can run in the browser without pulling in exceljs / DB code.
 */
export const CUSTOMER_EXPORT_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "nama", label: "Customer" },
  { key: "salesman", label: "Salesman" },
  { key: "tipeCustomer", label: "Tipe" },
  { key: "orderCycleDays", label: "Siklus (hari)" },
  { key: "lastOrderDate", label: "Transaksi terakhir" },
  { key: "daysSinceOrder", label: "Hari sejak order" },
  { key: "standing", label: "Status order" },
  { key: "statusCustomer", label: "Status" },
  { key: "createdAt", label: "Dibuat" },
] as const;

export type CustomerExportColumnKey = (typeof CUSTOMER_EXPORT_COLUMNS)[number]["key"];

const CUSTOMER_COLUMN_KEYS = new Set(
  CUSTOMER_EXPORT_COLUMNS.map((c) => c.key),
);

export const DEFAULT_CUSTOMER_EXPORT_COLUMNS: CustomerExportColumnKey[] =
  CUSTOMER_EXPORT_COLUMNS.map((c) => c.key);

export const CUSTOMER_EXPORT_STORAGE_KEY = "sigula.export.columns.customer";

/** Keep known keys in canonical order; empty/unknown → defaults. */
export function resolveCustomerColumns(raw: string[] | null | undefined): CustomerExportColumnKey[] {
  const picked = (raw ?? []).filter((k): k is CustomerExportColumnKey =>
    CUSTOMER_COLUMN_KEYS.has(k as CustomerExportColumnKey),
  );
  if (picked.length === 0) return [...DEFAULT_CUSTOMER_EXPORT_COLUMNS];
  return DEFAULT_CUSTOMER_EXPORT_COLUMNS.filter((k) => picked.includes(k));
}

export function parseColsParam(raw: string | null): CustomerExportColumnKey[] {
  if (!raw?.trim()) return [...DEFAULT_CUSTOMER_EXPORT_COLUMNS];
  return resolveCustomerColumns(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export const TRANSAKSI_EXPORT_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "customer", label: "Customer" },
  { key: "salesman", label: "Salesman" },
  { key: "tanggalOrder", label: "Tanggal order" },
  { key: "sumber", label: "Sumber" },
  { key: "catatan", label: "Catatan" },
  { key: "createdAt", label: "Dibuat" },
] as const;

export type TransaksiExportColumnKey = (typeof TRANSAKSI_EXPORT_COLUMNS)[number]["key"];

const TRANSAKSI_COLUMN_KEYS = new Set(TRANSAKSI_EXPORT_COLUMNS.map((c) => c.key));

export const DEFAULT_TRANSAKSI_EXPORT_COLUMNS: TransaksiExportColumnKey[] =
  TRANSAKSI_EXPORT_COLUMNS.map((c) => c.key);

export const TRANSAKSI_EXPORT_STORAGE_KEY = "sigula.export.columns.transaksi";

export function resolveTransaksiColumns(
  raw: string[] | null | undefined,
): TransaksiExportColumnKey[] {
  const picked = (raw ?? []).filter((k): k is TransaksiExportColumnKey =>
    TRANSAKSI_COLUMN_KEYS.has(k as TransaksiExportColumnKey),
  );
  if (picked.length === 0) return [...DEFAULT_TRANSAKSI_EXPORT_COLUMNS];
  return DEFAULT_TRANSAKSI_EXPORT_COLUMNS.filter((k) => picked.includes(k));
}

export function parseTransaksiColsParam(raw: string | null): TransaksiExportColumnKey[] {
  if (!raw?.trim()) return [...DEFAULT_TRANSAKSI_EXPORT_COLUMNS];
  return resolveTransaksiColumns(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export const SALESMAN_EXPORT_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "nama", label: "Salesman" },
  { key: "nomorWa", label: "WhatsApp" },
  { key: "supervisor", label: "Supervisor" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Dibuat" },
] as const;

export type SalesmanExportColumnKey = (typeof SALESMAN_EXPORT_COLUMNS)[number]["key"];
const SALESMAN_COLUMN_KEYS = new Set(SALESMAN_EXPORT_COLUMNS.map((c) => c.key));
export const DEFAULT_SALESMAN_EXPORT_COLUMNS: SalesmanExportColumnKey[] =
  SALESMAN_EXPORT_COLUMNS.map((c) => c.key);
export const SALESMAN_EXPORT_STORAGE_KEY = "sigula.export.columns.salesman";

export function resolveSalesmanColumns(
  raw: string[] | null | undefined,
): SalesmanExportColumnKey[] {
  const picked = (raw ?? []).filter((k): k is SalesmanExportColumnKey =>
    SALESMAN_COLUMN_KEYS.has(k as SalesmanExportColumnKey),
  );
  if (picked.length === 0) return [...DEFAULT_SALESMAN_EXPORT_COLUMNS];
  return DEFAULT_SALESMAN_EXPORT_COLUMNS.filter((k) => picked.includes(k));
}

export function parseSalesmanColsParam(raw: string | null): SalesmanExportColumnKey[] {
  if (!raw?.trim()) return [...DEFAULT_SALESMAN_EXPORT_COLUMNS];
  return resolveSalesmanColumns(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export const USER_EXPORT_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "username", label: "Username" },
  { key: "displayName", label: "Nama" },
  { key: "roles", label: "Role" },
  { key: "salesman", label: "Salesman" },
  { key: "isActive", label: "Aktif" },
  { key: "lastLoginAt", label: "Login terakhir" },
  { key: "createdAt", label: "Dibuat" },
] as const;

export type UserExportColumnKey = (typeof USER_EXPORT_COLUMNS)[number]["key"];
const USER_COLUMN_KEYS = new Set(USER_EXPORT_COLUMNS.map((c) => c.key));
export const DEFAULT_USER_EXPORT_COLUMNS: UserExportColumnKey[] =
  USER_EXPORT_COLUMNS.map((c) => c.key);
export const USER_EXPORT_STORAGE_KEY = "sigula.export.columns.user";

export function resolveUserColumns(raw: string[] | null | undefined): UserExportColumnKey[] {
  const picked = (raw ?? []).filter((k): k is UserExportColumnKey =>
    USER_COLUMN_KEYS.has(k as UserExportColumnKey),
  );
  if (picked.length === 0) return [...DEFAULT_USER_EXPORT_COLUMNS];
  return DEFAULT_USER_EXPORT_COLUMNS.filter((k) => picked.includes(k));
}

export function parseUserColsParam(raw: string | null): UserExportColumnKey[] {
  if (!raw?.trim()) return [...DEFAULT_USER_EXPORT_COLUMNS];
  return resolveUserColumns(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Log Audit sections that can be exported. */
export const AUDIT_EXPORT_SECTIONS = [
  { key: "activity", label: "Aktivitas record" },
  { key: "moves", label: "Mutasi salesman" },
  { key: "statuses", label: "Perubahan status" },
  { key: "replies", label: "Balasan WhatsApp" },
  { key: "exports", label: "Export" },
] as const;

export type AuditExportSection = (typeof AUDIT_EXPORT_SECTIONS)[number]["key"];

export const AUDIT_ACTIVITY_COLUMNS = [
  { key: "createdAt", label: "Waktu" },
  { key: "entityType", label: "Jenis record" },
  { key: "entityLabel", label: "Record" },
  { key: "action", label: "Aksi" },
  { key: "actorName", label: "Oleh" },
  { key: "changes", label: "Perubahan" },
] as const;

export const AUDIT_MOVES_COLUMNS = [
  { key: "tanggal", label: "Waktu" },
  { key: "customer", label: "Customer" },
  { key: "dari", label: "Dari" },
  { key: "ke", label: "Ke" },
  { key: "oleh", label: "Oleh" },
] as const;

export const AUDIT_STATUSES_COLUMNS = [
  { key: "tanggal", label: "Waktu" },
  { key: "customer", label: "Customer" },
  { key: "tipe", label: "Tipe" },
  { key: "oleh", label: "Oleh" },
] as const;

export const AUDIT_REPLIES_COLUMNS = [
  { key: "waktu", label: "Waktu" },
  { key: "dari", label: "Dari" },
  { key: "pesan", label: "Pesan" },
  { key: "outcome", label: "Hasil" },
  { key: "detail", label: "Detail" },
  { key: "balasan", label: "Balasan kami" },
] as const;

export const AUDIT_EXPORTS_COLUMNS = [
  { key: "createdAt", label: "Waktu" },
  { key: "listKey", label: "List" },
  { key: "mode", label: "Mode" },
  { key: "rowCount", label: "Baris" },
  { key: "filters", label: "Filter" },
  { key: "actorName", label: "Oleh" },
] as const;

export const AUDIT_SECTION_COLUMNS: Record<
  AuditExportSection,
  readonly { key: string; label: string }[]
> = {
  activity: AUDIT_ACTIVITY_COLUMNS,
  moves: AUDIT_MOVES_COLUMNS,
  statuses: AUDIT_STATUSES_COLUMNS,
  replies: AUDIT_REPLIES_COLUMNS,
  exports: AUDIT_EXPORTS_COLUMNS,
};

export function parseAuditSection(raw: string | null): AuditExportSection {
  const hit = AUDIT_EXPORT_SECTIONS.find((s) => s.key === raw);
  return hit?.key ?? "activity";
}

export function auditStorageKey(section: AuditExportSection) {
  return `sigula.export.columns.audit.${section}`;
}

export function resolveAuditColumns(
  section: AuditExportSection,
  raw: string[] | null | undefined,
): string[] {
  const catalogue = AUDIT_SECTION_COLUMNS[section];
  const allowed = new Set(catalogue.map((c) => c.key));
  const defaults = catalogue.map((c) => c.key);
  const picked = (raw ?? []).filter((k) => allowed.has(k));
  if (picked.length === 0) return defaults;
  return defaults.filter((k) => picked.includes(k));
}

export function parseAuditColsParam(section: AuditExportSection, raw: string | null): string[] {
  if (!raw?.trim()) return resolveAuditColumns(section, null);
  return resolveAuditColumns(
    section,
    raw.split(",").map((s) => s.trim()).filter(Boolean),
  );
}

/** Safe download basename (no path / extension). Empty → fallback. */
export function sanitizeExportBasename(raw: string | null | undefined, fallback = "export"): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\.xlsx$/i, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}
