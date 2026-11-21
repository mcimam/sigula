import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "~/db/client.server";
import { exportLogs } from "~/db/schema";
import { filteredCustomers, toExportRows } from "~/lib/customer-export.server";
import { buildCustomerExportXlsx, listExportPage, logExport } from "~/lib/export.server";
import type { CustomerFilters } from "~/lib/list-filters/customer";
import { addCustomer, resetDb, seedOrg } from "./helpers/fixtures";

const emptyFilters = (): CustomerFilters => ({
  q: "",
  trash: false,
  salesmanId: null,
  smTeam: false,
  standing: null,
  tipe: null,
  lastFrom: null,
  lastTo: null,
});

describe("customer export", () => {
  beforeEach(() => {
    resetDb();
  });

  it("exports every row matching the filter and logs the export", async () => {
    const org = await seedOrg();
    addCustomer({
      nama: "Overdue One",
      salesmanId: org.salesman.id,
      lastOrderDate: "2025-01-01",
    });
    addCustomer({
      nama: "Fresh Two",
      salesmanId: org.salesman.id,
      lastOrderDate: "2026-11-15",
    });
    addCustomer({
      nama: "Other Team",
      salesmanId: org.supervisor.id,
      lastOrderDate: "2025-01-01",
    });

    const filters: CustomerFilters = {
      ...emptyFilters(),
      salesmanId: org.salesman.id,
      standing: "overdue",
    };
    const rows = toExportRows(filteredCustomers(filters));
    expect(rows.map((r) => r.nama)).toEqual(["Overdue One"]);

    const buf = await buildCustomerExportXlsx(rows, ["nama", "standing", "lastOrderDate"]);
    const wb = new ExcelJS.Workbook();
    // exceljs typings accept Buffer via ArrayBuffer view
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Customer")!;
    expect(sheet.rowCount).toBe(2); // header + 1
    // Columns are emitted in catalogue order: nama, lastOrderDate, standing.
    expect(sheet.getRow(1).getCell(1).value).toBe("Customer");
    expect(sheet.getRow(1).getCell(2).value).toBe("Transaksi terakhir");
    expect(sheet.getRow(2).getCell(1).value).toBe("Overdue One");
    expect(sheet.getRow(2).getCell(2).value).toBeInstanceOf(Date);
    expect(sheet.getRow(2).getCell(3).value).toBe("Overdue");

    logExport({
      listKey: "customer",
      mode: "filtered",
      filters,
      rowCount: rows.length,
      columnKeys: ["nama", "standing", "lastOrderDate"],
      actorId: org.admin.id,
    });
    const logged = listExportPage(1, 10);
    expect(logged.total).toBe(1);
    expect(logged.rows[0]).toMatchObject({
      listKey: "customer",
      mode: "filtered",
      rowCount: 1,
    });
    expect(db.select().from(exportLogs).all()).toHaveLength(1);
  });

  it("selected export keeps only ids that still match the filter (BR-E1)", async () => {
    const org = await seedOrg();
    const a = addCustomer({
      nama: "Keep",
      salesmanId: org.salesman.id,
      lastOrderDate: "2025-01-01",
    });
    const b = addCustomer({
      nama: "Drop standing",
      salesmanId: org.salesman.id,
      lastOrderDate: "2026-11-15",
    });
    const c = addCustomer({
      nama: "Drop salesman",
      salesmanId: org.supervisor.id,
      lastOrderDate: "2025-01-01",
    });

    const filters: CustomerFilters = {
      ...emptyFilters(),
      salesmanId: org.salesman.id,
      standing: "overdue",
    };
    const requested = new Set([a.id, b.id, c.id, 99999]);
    const allowed = filteredCustomers(filters).filter((row) => requested.has(row.id));
    expect(allowed.map((row) => row.id)).toEqual([a.id]);
  });

  it("expands smTeam to subordinates (ADR-0004)", async () => {
    const org = await seedOrg();
    addCustomer({
      nama: "Lead cust",
      salesmanId: org.supervisor.id,
      lastOrderDate: "2025-01-01",
    });
    addCustomer({
      nama: "Sub cust",
      salesmanId: org.salesman.id,
      lastOrderDate: "2025-01-01",
    });

    const exact = filteredCustomers({
      ...emptyFilters(),
      salesmanId: org.supervisor.id,
      smTeam: false,
    });
    expect(exact.map((r) => r.nama)).toEqual(["Lead cust"]);

    const team = filteredCustomers({
      ...emptyFilters(),
      salesmanId: org.supervisor.id,
      smTeam: true,
    });
    expect(team.map((r) => r.nama).sort()).toEqual(["Lead cust", "Sub cust"]);
  });
});
