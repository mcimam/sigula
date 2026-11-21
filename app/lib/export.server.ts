import ExcelJS from "exceljs";
import { count, desc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { exportLogs, users, type ExportMode } from "~/db/schema";
import { nowIso, parseIsoDate } from "~/lib/dates";
import {
  CUSTOMER_EXPORT_COLUMNS,
  resolveCustomerColumns,
  resolveSalesmanColumns,
  resolveTransaksiColumns,
  resolveUserColumns,
  SALESMAN_EXPORT_COLUMNS,
  TRANSAKSI_EXPORT_COLUMNS,
  USER_EXPORT_COLUMNS,
  type CustomerExportColumnKey,
  type SalesmanExportColumnKey,
  type TransaksiExportColumnKey,
  type UserExportColumnKey,
} from "~/lib/export-columns";
import type { CustomerFilters } from "~/lib/list-filters/customer";
import type { SalesmanExportRow, UserExportRow } from "~/lib/masterdata-export.server";
import { pageWindow } from "~/lib/pagination";

export {
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_EXPORT_STORAGE_KEY,
  DEFAULT_CUSTOMER_EXPORT_COLUMNS,
  DEFAULT_SALESMAN_EXPORT_COLUMNS,
  DEFAULT_TRANSAKSI_EXPORT_COLUMNS,
  DEFAULT_USER_EXPORT_COLUMNS,
  parseColsParam,
  parseSalesmanColsParam,
  parseTransaksiColsParam,
  parseUserColsParam,
  resolveCustomerColumns,
  resolveSalesmanColumns,
  resolveTransaksiColumns,
  resolveUserColumns,
  SALESMAN_EXPORT_COLUMNS,
  SALESMAN_EXPORT_STORAGE_KEY,
  TRANSAKSI_EXPORT_COLUMNS,
  TRANSAKSI_EXPORT_STORAGE_KEY,
  USER_EXPORT_COLUMNS,
  USER_EXPORT_STORAGE_KEY,
  type CustomerExportColumnKey,
  type SalesmanExportColumnKey,
  type TransaksiExportColumnKey,
  type UserExportColumnKey,
} from "~/lib/export-columns";

export type CustomerExportRow = {
  id: number;
  nama: string;
  salesman: string;
  tipeCustomer: string;
  orderCycleDays: number;
  lastOrderDate: string | null;
  daysSinceOrder: number | null;
  overdue: boolean;
  statusCustomer: string;
  createdAt: string;
};

function cellValue(row: CustomerExportRow, key: CustomerExportColumnKey): ExcelJS.CellValue {
  switch (key) {
    case "id":
      return row.id;
    case "nama":
      return row.nama;
    case "salesman":
      return row.salesman;
    case "tipeCustomer":
      return row.tipeCustomer;
    case "orderCycleDays":
      return row.orderCycleDays;
    case "lastOrderDate":
      return row.lastOrderDate ? parseIsoDate(row.lastOrderDate) : null;
    case "daysSinceOrder":
      return row.daysSinceOrder ?? "belum pernah";
    case "standing":
      return row.overdue ? "Overdue" : "On track";
    case "statusCustomer":
      return row.statusCustomer;
    case "createdAt": {
      // createdAt is ISO-UTC timestamp; Excel date from the UTC instant.
      const d = new Date(row.createdAt);
      return Number.isNaN(d.getTime()) ? row.createdAt : d;
    }
    default:
      return null;
  }
}

function isDateColumn(key: CustomerExportColumnKey) {
  return key === "lastOrderDate" || key === "createdAt";
}

async function workbookBuffer(wb: ExcelJS.Workbook) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** One-sheet Customer export; date columns are real Excel dates. */
export async function buildCustomerExportXlsx(
  rows: CustomerExportRow[],
  columnKeys: CustomerExportColumnKey[],
) {
  const cols = resolveCustomerColumns(columnKeys);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Customer");
  const headers = cols.map(
    (key) => CUSTOMER_EXPORT_COLUMNS.find((c) => c.key === key)!.label,
  );
  sheet.addRow(headers);
  for (const row of rows) {
    const excelRow = sheet.addRow(cols.map((key) => cellValue(row, key)));
    cols.forEach((key, i) => {
      if (!isDateColumn(key)) return;
      const cell = excelRow.getCell(i + 1);
      if (cell.value instanceof Date) {
        cell.numFmt = key === "lastOrderDate" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm";
      }
    });
  }
  return workbookBuffer(wb);
}

export type TransaksiExportRow = {
  id: number;
  customer: string;
  salesman: string;
  tanggalOrder: string;
  sumber: string;
  catatan: string;
  createdAt: string;
};

function transaksiCellValue(
  row: TransaksiExportRow,
  key: TransaksiExportColumnKey,
): ExcelJS.CellValue {
  switch (key) {
    case "id":
      return row.id;
    case "customer":
      return row.customer;
    case "salesman":
      return row.salesman;
    case "tanggalOrder":
      return parseIsoDate(row.tanggalOrder);
    case "sumber":
      return row.sumber;
    case "catatan":
      return row.catatan;
    case "createdAt": {
      const d = new Date(row.createdAt);
      return Number.isNaN(d.getTime()) ? row.createdAt : d;
    }
    default:
      return null;
  }
}

/** One-sheet Transaksi export; date columns are real Excel dates. */
export async function buildTransaksiExportXlsx(
  rows: TransaksiExportRow[],
  columnKeys: TransaksiExportColumnKey[],
) {
  const cols = resolveTransaksiColumns(columnKeys);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Transaksi");
  sheet.addRow(cols.map((key) => TRANSAKSI_EXPORT_COLUMNS.find((c) => c.key === key)!.label));
  for (const row of rows) {
    const excelRow = sheet.addRow(cols.map((key) => transaksiCellValue(row, key)));
    cols.forEach((key, i) => {
      if (key !== "tanggalOrder" && key !== "createdAt") return;
      const cell = excelRow.getCell(i + 1);
      if (cell.value instanceof Date) {
        cell.numFmt = key === "tanggalOrder" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm";
      }
    });
  }
  return workbookBuffer(wb);
}

function salesmanCellValue(
  row: SalesmanExportRow,
  key: SalesmanExportColumnKey,
): ExcelJS.CellValue {
  switch (key) {
    case "id":
      return row.id;
    case "nama":
      return row.nama;
    case "nomorWa":
      return row.nomorWa;
    case "supervisor":
      return row.supervisor;
    case "status":
      return row.status;
    case "createdAt": {
      const d = new Date(row.createdAt);
      return Number.isNaN(d.getTime()) ? row.createdAt : d;
    }
    default:
      return null;
  }
}

/** One-sheet Salesman export. */
export async function buildSalesmanExportXlsx(
  rows: SalesmanExportRow[],
  columnKeys: SalesmanExportColumnKey[],
) {
  const cols = resolveSalesmanColumns(columnKeys);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Salesman");
  sheet.addRow(cols.map((key) => SALESMAN_EXPORT_COLUMNS.find((c) => c.key === key)!.label));
  for (const row of rows) {
    const excelRow = sheet.addRow(cols.map((key) => salesmanCellValue(row, key)));
    cols.forEach((key, i) => {
      if (key !== "createdAt") return;
      const cell = excelRow.getCell(i + 1);
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd hh:mm";
    });
  }
  return workbookBuffer(wb);
}

function userCellValue(row: UserExportRow, key: UserExportColumnKey): ExcelJS.CellValue {
  switch (key) {
    case "id":
      return row.id;
    case "username":
      return row.username;
    case "displayName":
      return row.displayName;
    case "roles":
      return row.roles;
    case "salesman":
      return row.salesman;
    case "isActive":
      return row.isActive;
    case "lastLoginAt": {
      if (!row.lastLoginAt) return "";
      const d = new Date(row.lastLoginAt);
      return Number.isNaN(d.getTime()) ? row.lastLoginAt : d;
    }
    case "createdAt": {
      const d = new Date(row.createdAt);
      return Number.isNaN(d.getTime()) ? row.createdAt : d;
    }
    default:
      return null;
  }
}

/** One-sheet User export. */
export async function buildUserExportXlsx(
  rows: UserExportRow[],
  columnKeys: UserExportColumnKey[],
) {
  const cols = resolveUserColumns(columnKeys);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("User");
  sheet.addRow(cols.map((key) => USER_EXPORT_COLUMNS.find((c) => c.key === key)!.label));
  for (const row of rows) {
    const excelRow = sheet.addRow(cols.map((key) => userCellValue(row, key)));
    cols.forEach((key, i) => {
      if (key !== "createdAt" && key !== "lastLoginAt") return;
      const cell = excelRow.getCell(i + 1);
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd hh:mm";
    });
  }
  return workbookBuffer(wb);
}

function displayNameOf(userId: number | null) {
  if (userId === null) return "";
  return (
    db.select({ n: users.displayName }).from(users).where(eq(users.id, userId)).get()?.n ?? ""
  );
}

export function logExport(opts: {
  listKey: string;
  mode: ExportMode;
  filters: CustomerFilters | Record<string, unknown>;
  rowCount: number;
  columnKeys: string[];
  actorId?: number | null;
}) {
  const actorId = opts.actorId ?? null;
  db.insert(exportLogs)
    .values({
      listKey: opts.listKey,
      mode: opts.mode,
      filters: JSON.stringify(opts.filters),
      rowCount: opts.rowCount,
      columnKeys: JSON.stringify(opts.columnKeys),
      actorId,
      actorName: displayNameOf(actorId),
      createdAt: nowIso(),
    })
    .run();
}

export type ExportLogItem = {
  id: number;
  listKey: string;
  mode: ExportMode;
  filters: Record<string, unknown>;
  rowCount: number;
  columnKeys: string[];
  actorName: string;
  createdAt: string;
};

function toExportItem(row: typeof exportLogs.$inferSelect): ExportLogItem {
  let filters: Record<string, unknown> = {};
  let columnKeys: string[] = [];
  try {
    filters = JSON.parse(row.filters) as Record<string, unknown>;
  } catch {
    filters = {};
  }
  try {
    columnKeys = JSON.parse(row.columnKeys) as string[];
  } catch {
    columnKeys = [];
  }
  return {
    id: row.id,
    listKey: row.listKey,
    mode: row.mode,
    filters,
    rowCount: row.rowCount,
    columnKeys,
    actorName: row.actorName,
    createdAt: row.createdAt,
  };
}

/** Log Audit → Export: newest first, paged in SQL. */
export function listExportPage(page: number, pageSize: number) {
  const total = db.select({ n: count() }).from(exportLogs).get()!.n;
  const { page: p, totalPages, offset } = pageWindow(total, page, pageSize);
  const rows = db
    .select()
    .from(exportLogs)
    .orderBy(desc(exportLogs.id))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map(toExportItem);
  return { rows, total, page: p, totalPages, pageSize };
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
