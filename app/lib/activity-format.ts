import type { ActivityAction, ActivityEntity } from "~/lib/activity-entities";
import { BUSINESS_TIMEZONE } from "~/lib/dates";

export type FieldChange = { from: string | number | null; to: string | number | null };
export type Changes = Record<string, FieldChange>;

export type ActivityItem = {
  id: number;
  entityType: ActivityEntity;
  entityId: number;
  entityLabel: string;
  action: ActivityAction;
  actorName: string;
  createdAt: string;
  changes: Changes;
};

export const COMMENT_MAX_LENGTH = 2000;

/** The query parameter that carries a record's feed page (the panel itself is `?edit=`). */
export const FEED_PAGE_PARAM = "activityPage";

/** A message left on a record's panel. */
export type CommentItem = { id: number; authorName: string; body: string; createdAt: string };

/** One row of a record's "Aktivitas & komentar" feed: an automatic log entry or a comment. */
export type FeedEntry =
  | { kind: "log"; item: ActivityItem }
  | { kind: "comment"; item: CommentItem };

export type FeedPage = { entries: FeedEntry[]; total: number; page: number; totalPages: number };

export const ENTITY_LABELS: Record<ActivityEntity, string> = {
  transaksi: "Transaksi",
  customer: "Customer",
  salesman: "Salesman",
  user: "User",
  template: "Template",
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
  restore: "Dipulihkan",
};

export const FIELD_LABELS: Record<string, string> = {
  customer: "Customer",
  salesman: "Salesman",
  tanggal_order: "Tanggal order",
  catatan: "Catatan",
  sumber: "Sumber",
  nama: "Nama",
  tipe_customer: "Tipe",
  status_customer: "Status",
  alasan_keterlambatan: "Alasan keterlambatan",
  pengingat_dikirim: "Pengingat dikirim",
  order_cycle_days: "Siklus (hari)",
  nomor_wa: "Nomor WA",
  supervisor: "Supervisor",
  status: "Status",
  username: "Username",
  display_name: "Nama tampilan",
  role: "Role",
  roles: "Role",
  is_active: "Status akun",
  password: "Password",
  transaksi_terhapus: "Transaksi ikut terhapus",
  transaksi_dipulihkan: "Transaksi ikut dipulihkan",
  body: "Isi pesan",
  subject: "Subjek",
};

export function fieldLabel(key: string) {
  return FIELD_LABELS[key] ?? key;
}

export function formatValue(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

/**
 * "2026-09-26T08:15:00Z" (UTC, as stored) → "26 Sep 2026 15.15" in WIB.
 * Zone is pinned (not the viewer's) so server render and hydration agree.
 * Still reads the older space-separated form for any row not yet converted.
 */
export function formatStamp(stamp: string) {
  const d = new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return stamp;
  return d.toLocaleString("id-ID", {
    timeZone: BUSINESS_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Maya Chen" → "MC"; an empty name (the system acted) → "S". */
export function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase());
  return letters.length ? letters.join("") : "S";
}
