import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";
import { recordOrder } from "~/lib/orders.server";

const HEADER_NAME = "Nama Konsumen";
const HEADER_STATUS = "Status (Lama/Baru)";
const HEADER_DATE = "Tgl Terakhir Order";
const HEADER_SCAN_ROWS = 8;

export class UnresolvedSheetsError extends Error {
  unknownSheets: string[];
  constructor(unknownSheets: string[]) {
    super(`Unresolved sheet names: ${unknownSheets.join(", ")}`);
    this.unknownSheets = unknownSheets;
  }
}

export type NewCustomerRow = {
  sheetName: string;
  salesmanId: number | null;
  nama: string;
  tipeCustomer: "lama" | "baru";
  lastOrderDate: string | null;
};

export type UpdatedCustomerRow = {
  customerId: number;
  nama: string;
  salesmanId: number;
  oldDate: string | null;
  newDate: string;
};

export type ImportPreview = {
  newCustomers: NewCustomerRow[];
  updatedCustomers: UpdatedCustomerRow[];
  unchangedCount: number;
  unknownSheets: string[];
};

export type ImportResult = {
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  newSalesmen: string[];
};

function excelDateToIso(value: unknown): string | null {
  // DEBT-001: FRD says last_order_date must not be future — not enforced yet.
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86_400_000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function normalizeTipe(raw: unknown): "lama" | "baru" {
  const t = String(raw ?? "").trim().toLowerCase();
  return t.startsWith("baru") ? "baru" : "lama";
}

async function loadWorkbook(buffer: ArrayBuffer | Buffer) {
  const workbook = new ExcelJS.Workbook();
  // exceljs types Buffer; ArrayBuffer from FormData needs conversion
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  return workbook;
}

function findColumns(sheet: ExcelJS.Worksheet) {
  const max = Math.min(HEADER_SCAN_ROWS, sheet.rowCount || HEADER_SCAN_ROWS);
  for (let r = 1; r <= max; r++) {
    const row = sheet.getRow(r);
    const values = (row.values as unknown[]) ?? [];
    let colName = -1;
    let colStatus = -1;
    let colDate = -1;
    for (let c = 1; c < values.length; c++) {
      const cell = String(values[c] ?? "").trim();
      if (cell === HEADER_NAME) colName = c;
      if (cell === HEADER_STATUS) colStatus = c;
      if (cell === HEADER_DATE) colDate = c;
    }
    if (colName > 0 && colStatus > 0 && colDate > 0) {
      return { headerRow: r, colName, colStatus, colDate };
    }
  }
  return null;
}

function sheetRows(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  colName: number,
  colStatus: number,
  colDate: number,
) {
  // Deduplicate by nama within sheet — last date wins (FRD edge case)
  const byName = new Map<
    string,
    { nama: string; tipeCustomer: "lama" | "baru"; lastOrderDate: string | null }
  >();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const nama = String(row.getCell(colName).value ?? "").trim();
    if (!nama) return;
    byName.set(nama.toUpperCase(), {
      nama,
      tipeCustomer: normalizeTipe(row.getCell(colStatus).value),
      lastOrderDate: excelDateToIso(row.getCell(colDate).value),
    });
  });
  return [...byName.values()];
}

export async function parsePreview(
  buffer: ArrayBuffer | Buffer,
): Promise<ImportPreview> {
  const workbook = await loadWorkbook(buffer);
  const allSalesmen = db.select().from(salesmen).all();
  const byName = new Map(
    allSalesmen.map((s) => [s.nama.trim().toUpperCase(), s]),
  );

  const preview: ImportPreview = {
    newCustomers: [],
    updatedCustomers: [],
    unchangedCount: 0,
    unknownSheets: [],
  };

  for (const sheet of workbook.worksheets) {
    const cols = findColumns(sheet);
    if (!cols) continue;

    const salesman = byName.get(sheet.name.trim().toUpperCase()) ?? null;
    if (!salesman) preview.unknownSheets.push(sheet.name);

    for (const row of sheetRows(
      sheet,
      cols.headerRow,
      cols.colName,
      cols.colStatus,
      cols.colDate,
    )) {
      if (!salesman) {
        preview.newCustomers.push({
          sheetName: sheet.name,
          salesmanId: null,
          nama: row.nama,
          tipeCustomer: row.tipeCustomer,
          lastOrderDate: row.lastOrderDate,
        });
        continue;
      }

      const existing = db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.nama, row.nama),
            eq(customers.salesmanId, salesman.id),
          ),
        )
        .get();

      if (!existing) {
        preview.newCustomers.push({
          sheetName: sheet.name,
          salesmanId: salesman.id,
          nama: row.nama,
          tipeCustomer: row.tipeCustomer,
          lastOrderDate: row.lastOrderDate,
        });
        continue;
      }

      if (
        row.lastOrderDate &&
        row.lastOrderDate !== existing.lastOrderDate
      ) {
        preview.updatedCustomers.push({
          customerId: existing.id,
          nama: existing.nama,
          salesmanId: salesman.id,
          oldDate: existing.lastOrderDate,
          newDate: row.lastOrderDate,
        });
      } else {
        preview.unchangedCount += 1;
      }
    }
  }

  return preview;
}

export async function confirmImport(opts: {
  buffer: ArrayBuffer | Buffer;
  actingUserId: number;
  treatUnknownSheetsAsNewSalesman: boolean;
}): Promise<ImportResult> {
  const preview = await parsePreview(opts.buffer);
  if (preview.unknownSheets.length > 0 && !opts.treatUnknownSheetsAsNewSalesman) {
    throw new UnresolvedSheetsError(preview.unknownSheets);
  }

  const newSalesmen: string[] = [];
  const sheetToSalesmanId = new Map<string, number>();

  for (const sheetName of preview.unknownSheets) {
    const created = db
      .insert(salesmen)
      .values({ nama: sheetName, status: "aktif" })
      .returning()
      .get();
    newSalesmen.push(created.nama);
    sheetToSalesmanId.set(sheetName, created.id);
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const row of preview.newCustomers) {
    let salesmanId = row.salesmanId;
    if (salesmanId == null) {
      salesmanId = sheetToSalesmanId.get(row.sheetName)!;
    }
    const created = db
      .insert(customers)
      .values({
        nama: row.nama,
        salesmanId,
        tipeCustomer: row.tipeCustomer,
        orderCycleDays: 30,
        statusCustomer: "aktif",
        lastOrderDate: null,
        notified: false,
      })
      .returning()
      .get();
    if (row.lastOrderDate) {
      recordOrder({
        customerId: created.id,
        actingUserId: opts.actingUserId,
        tanggalOrder: row.lastOrderDate,
        sumber: "import",
      });
    }
    newCount += 1;
  }

  for (const row of preview.updatedCustomers) {
    recordOrder({
      customerId: row.customerId,
      actingUserId: opts.actingUserId,
      tanggalOrder: row.newDate,
      sumber: "import",
    });
    updatedCount += 1;
  }

  return {
    newCount,
    updatedCount,
    unchangedCount: preview.unchangedCount,
    newSalesmen,
  };
}

/**
 * Blank Order_Tracker-shaped workbook: one example sheet named after a
 * salesman, with the three required header columns and one sample row.
 */
export async function buildImportTemplate(opts?: {
  exampleSheetName?: string;
}): Promise<Buffer> {
  const sheetName = opts?.exampleSheetName?.trim() || "Nama Salesman";
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow([HEADER_NAME, HEADER_STATUS, HEADER_DATE]);
  sheet.addRow(["Contoh Toko ABC", "Lama", "2026-01-15"]);
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 20;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
