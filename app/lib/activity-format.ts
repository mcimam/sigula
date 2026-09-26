import type { ActivityAction, ActivityEntity } from "~/db/schema";

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

export const ENTITY_LABELS: Record<ActivityEntity, string> = {
  transaksi: "Transaksi",
  customer: "Customer",
  salesman: "Salesman",
  user: "User",
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
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
  order_cycle_days: "Siklus (hari)",
  nomor_wa: "Nomor WA",
  supervisor: "Supervisor",
  status: "Status",
  username: "Username",
  display_name: "Nama tampilan",
  role: "Role",
  password: "Password",
  transaksi_terhapus: "Transaksi ikut terhapus",
};

export function fieldLabel(key: string) {
  return FIELD_LABELS[key] ?? key;
}

export function formatValue(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

/**
 * "2026-09-26 08:15:00" (UTC, as stored) → "26 Sep 2026 15.15" in WIB.
 * Zone is pinned (not the viewer's) so server render and hydration agree.
 */
export function formatStamp(stamp: string) {
  const d = new Date(stamp.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return stamp;
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
