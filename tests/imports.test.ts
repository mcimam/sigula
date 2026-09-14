import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";
import {
  confirmImport,
  parsePreview,
  UnresolvedSheetsError,
} from "~/lib/imports.server";

import {
  addCustomer,
  getCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

async function buildWorkbook(
  sheets: {
    name: string;
    rows: [string, string, string | Date | null][];
  }[],
) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRow(["Nama Konsumen", "Status (Lama/Baru)", "Tgl Terakhir Order"]);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("Excel import (FR-18–FR-21, BR-7/BR-8)", () => {
  beforeEach(() => resetDb());

  it("preview diffs new / updated / unchanged against master data", async () => {
    const { salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Toko Lama",
      lastOrderDate: "2026-01-01",
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Toko Sama",
      lastOrderDate: "2026-02-01",
    });

    const buf = await buildWorkbook([
      {
        name: "Andi Sales",
        rows: [
          ["Toko Lama", "Lama", "2026-03-01"],
          ["Toko Sama", "Lama", "2026-02-01"],
          ["Toko Baru", "Baru", "2026-04-01"],
        ],
      },
    ]);

    const preview = await parsePreview(buf);
    expect(preview.updatedCustomers).toHaveLength(1);
    expect(preview.updatedCustomers[0].nama).toBe("Toko Lama");
    expect(preview.newCustomers).toHaveLength(1);
    expect(preview.newCustomers[0].nama).toBe("Toko Baru");
    expect(preview.unchangedCount).toBe(1);
    expect(preview.unknownSheets).toHaveLength(0);
  });

  it("lists unknown sheets and blocks confirm without override (FR-20)", async () => {
    const { admin } = await seedOrg();
    const buf = await buildWorkbook([
      {
        name: "Salesman Ghost",
        rows: [["Pelanggan X", "Baru", "2026-04-01"]],
      },
    ]);
    const preview = await parsePreview(buf);
    expect(preview.unknownSheets).toEqual(["Salesman Ghost"]);

    await expect(
      confirmImport({
        buffer: buf,
        actingUserId: admin.id,
        treatUnknownSheetsAsNewSalesman: false,
      }),
    ).rejects.toBeInstanceOf(UnresolvedSheetsError);
  });

  it("creates new salesman when override is set and commits rows", async () => {
    const { admin } = await seedOrg();
    const buf = await buildWorkbook([
      {
        name: "Salesman Ghost",
        rows: [["Pelanggan X", "Baru", "2026-04-01"]],
      },
    ]);
    const result = await confirmImport({
      buffer: buf,
      actingUserId: admin.id,
      treatUnknownSheetsAsNewSalesman: true,
    });
    expect(result.newSalesmen).toEqual(["Salesman Ghost"]);
    expect(result.newCount).toBe(1);
    const sm = db
      .select()
      .from(salesmen)
      .all()
      .find((s) => s.nama === "Salesman Ghost");
    expect(sm).toBeTruthy();
    const created = db
      .select()
      .from(customers)
      .where(eq(customers.nama, "Pelanggan X"))
      .get();
    expect(created?.salesmanId).toBe(sm!.id);
    expect(created?.lastOrderDate).toBe("2026-04-01");
  });

  it("updates last_order_date only and can auto-reactivate (FR-21)", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-01-01",
      statusCustomer: "inactive",
      tipeCustomer: "lama",
    });
    const buf = await buildWorkbook([
      {
        name: "Andi Sales",
        rows: [["Toko", "Baru", "2026-05-01"]],
      },
    ]);
    await confirmImport({
      buffer: buf,
      actingUserId: admin.id,
      treatUnknownSheetsAsNewSalesman: false,
    });
    const updated = getCustomer(c.id);
    expect(updated.lastOrderDate).toBe("2026-05-01");
    expect(updated.statusCustomer).toBe("aktif");
    // BR-8: tipe_customer must not be overwritten on update
    expect(updated.tipeCustomer).toBe("lama");
  });

  it("dedupes repeated names in a sheet keeping the last date", async () => {
    const { salesman } = await seedOrg();
    const buf = await buildWorkbook([
      {
        name: "Andi Sales",
        rows: [
          ["Dup", "Lama", "2026-01-01"],
          ["Dup", "Lama", "2026-06-15"],
        ],
      },
    ]);
    const preview = await parsePreview(buf);
    expect(preview.newCustomers).toHaveLength(1);
    expect(preview.newCustomers[0].lastOrderDate).toBe("2026-06-15");
    void salesman;
  });

  it("matches sheet names case-insensitively (BR-7)", async () => {
    await seedOrg();
    const buf = await buildWorkbook([
      {
        name: "andi sales",
        rows: [["Z", "Baru", "2026-04-01"]],
      },
    ]);
    const preview = await parsePreview(buf);
    expect(preview.unknownSheets).toHaveLength(0);
    expect(preview.newCustomers[0].salesmanId).not.toBeNull();
  });

  it("buildImportTemplate is parseable with the expected headers", async () => {
    const { buildImportTemplate } = await import("~/lib/imports.server");
    await seedOrg();
    const buf = await buildImportTemplate({ exampleSheetName: "Andi Sales" });
    const preview = await parsePreview(buf);
    expect(preview.unknownSheets).toHaveLength(0);
    expect(preview.newCustomers.some((r) => r.nama === "Contoh Toko ABC")).toBe(
      true,
    );
  });
});
