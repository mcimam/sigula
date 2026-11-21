import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

import { db } from "~/db/client.server";
import { users } from "~/db/schema";
import { ACTIVITY_ENTITIES } from "~/lib/activity-entities";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  fieldLabel,
  formatValue,
  type ActivityItem,
} from "~/lib/activity-format";
import { listActivityPage } from "~/lib/activity.server";
import { listAssignmentMovesPage, listStatusChangesPage } from "~/lib/customer-history.server";
import {
  AUDIT_EXPORT_SECTIONS,
  AUDIT_SECTION_COLUMNS,
  resolveAuditColumns,
  type AuditExportSection,
} from "~/lib/export-columns";
import { listExportPage } from "~/lib/export.server";
import { listInboundPage } from "~/lib/inbound.server";
import { customerName, salesmanName } from "~/lib/names.server";

/** Pilot-scale ceiling: same pattern as transaksi list cap. */
const AUDIT_EXPORT_CAP = 10_000;

const LIST_KEY_LABELS: Record<string, string> = {
  customer: "Customer",
  transaksi: "Transaksi",
  salesman: "Salesman",
  user: "User",
};
const EXPORT_MODE_LABELS = {
  filtered: "Semua hasil filter",
  selected: "Terpilih",
} as const;

const REPLY_OUTCOMES: Record<string, string> = {
  recorded: "dicatat",
  unrecognized: "tidak dikenali",
  nothing_pending: "tidak ada yang menunggu",
  unknown_sender: "bukan salesman",
};
const REPLY_SENT: Record<string, string> = {
  none: "—",
  sent: "terkirim",
  failed: "gagal terkirim",
};

export type AuditListFilters = {
  section: AuditExportSection;
  q: string;
  entity: string;
};

function usernameOf(id: number | null) {
  if (id == null) return "system";
  return db.select().from(users).where(eq(users.id, id)).get()?.username ?? "?";
}

function formatChanges(item: ActivityItem): string {
  const entries = Object.entries(item.changes);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, c]) => {
      const label = fieldLabel(key);
      if (item.action === "update") {
        return `${label} ${formatValue(c.from)} → ${formatValue(c.to)}`;
      }
      const value =
        item.action === "create" || item.action === "restore" ? c.to : c.from;
      return `${label} ${formatValue(value)}`;
    })
    .join("; ");
}

function summarizeFilters(filters: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === false || v === "" || v === undefined) continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? parts.join(", ") : "—";
}

export function auditSheetName(section: AuditExportSection) {
  return AUDIT_EXPORT_SECTIONS.find((s) => s.key === section)?.label ?? section;
}

export function auditColumnLabels(section: AuditExportSection, keys: string[]) {
  const catalogue = AUDIT_SECTION_COLUMNS[section];
  return keys.map((key) => catalogue.find((c) => c.key === key)?.label ?? key);
}

/** Flat string rows for one audit section (current filters for activity). */
export function filteredAuditRows(
  filters: AuditListFilters,
): Record<string, string | number>[] {
  const { section, q, entity } = filters;
  const entityFilter =
    entity && (ACTIVITY_ENTITIES as readonly string[]).includes(entity) ? entity : "";

  switch (section) {
    case "activity": {
      const page = listActivityPage({
        entity: entityFilter,
        q,
        page: 1,
        pageSize: AUDIT_EXPORT_CAP,
      });
      return page.rows.map((a) => ({
        createdAt: a.createdAt,
        entityType: ENTITY_LABELS[a.entityType] ?? a.entityType,
        entityLabel: a.entityLabel,
        action: ACTION_LABELS[a.action] ?? a.action,
        actorName: a.actorName || "sistem",
        changes: formatChanges(a),
      }));
    }
    case "moves": {
      const page = listAssignmentMovesPage(1, AUDIT_EXPORT_CAP);
      return page.rows.map((m) => ({
        tanggal: m.at,
        customer: customerName(m.customerId),
        dari: salesmanName(m.fromSalesmanId),
        ke: salesmanName(m.toSalesmanId),
        oleh: usernameOf(m.byId),
      }));
    }
    case "statuses": {
      const page = listStatusChangesPage(1, AUDIT_EXPORT_CAP);
      return page.rows.map((s) => ({
        tanggal: s.changedAt,
        customer: customerName(s.customerId),
        tipe: s.reason || `${s.fromStatus} → ${s.toStatus}`,
        oleh: usernameOf(s.changedById),
      }));
    }
    case "replies": {
      const page = listInboundPage(1, AUDIT_EXPORT_CAP);
      return page.rows.map((r) => ({
        waktu: r.receivedAt,
        dari: r.salesmanId ? salesmanName(r.salesmanId) : `+${r.fromAddress}`,
        pesan: r.body,
        outcome: REPLY_OUTCOMES[r.outcome] ?? r.outcome,
        detail: r.detail ?? "",
        balasan: REPLY_SENT[r.replyStatus] ?? r.replyStatus,
      }));
    }
    case "exports": {
      const page = listExportPage(1, AUDIT_EXPORT_CAP);
      return page.rows.map((row) => ({
        createdAt: row.createdAt,
        listKey: LIST_KEY_LABELS[row.listKey] ?? row.listKey,
        mode: EXPORT_MODE_LABELS[row.mode] ?? row.mode,
        rowCount: row.rowCount,
        filters: summarizeFilters(row.filters),
        actorName: row.actorName || "sistem",
      }));
    }
  }
}

const DATE_KEYS = new Set(["createdAt", "tanggal", "waktu"]);

function auditCellValue(key: string, value: string | number): ExcelJS.CellValue {
  if (!DATE_KEYS.has(key) || typeof value !== "string" || !value) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d;
}

/** One-sheet Log Audit export for a chosen section. */
export async function buildAuditExportXlsx(
  section: AuditExportSection,
  rows: Record<string, string | number>[],
  columnKeys: string[],
) {
  const cols = resolveAuditColumns(section, columnKeys);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(auditSheetName(section).slice(0, 31));
  sheet.addRow(auditColumnLabels(section, cols));
  for (const row of rows) {
    const excelRow = sheet.addRow(cols.map((key) => auditCellValue(key, row[key] ?? "")));
    cols.forEach((key, i) => {
      if (!DATE_KEYS.has(key)) return;
      const cell = excelRow.getCell(i + 1);
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd hh:mm";
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
