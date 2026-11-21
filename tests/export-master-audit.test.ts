import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAuditExportXlsx,
  filteredAuditRows,
} from "~/lib/audit-export.server";
import { buildSalesmanExportXlsx, buildUserExportXlsx, logExport } from "~/lib/export.server";
import { filteredSalesmen, filteredUsers } from "~/lib/masterdata-export.server";
import { deleteSalesmenMany } from "~/lib/masterdata.server";
import { resetDb, seedOrg } from "./helpers/fixtures";

describe("salesman / user / audit export", () => {
  beforeEach(() => {
    resetDb();
  });

  it("exports live salesmen matching q", async () => {
    const org = await seedOrg();
    const rows = filteredSalesmen({ q: org.salesman.nama.toLowerCase(), trash: false });
    expect(rows.some((r) => r.id === org.salesman.id)).toBe(true);

    const buf = await buildSalesmanExportXlsx(rows, ["nama", "status"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Salesman")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Salesman");
    expect(sheet.rowCount).toBeGreaterThanOrEqual(2);

    logExport({
      listKey: "salesman",
      mode: "filtered",
      filters: { q: org.salesman.nama.toLowerCase(), trash: false },
      rowCount: rows.length,
      columnKeys: ["nama", "status"],
      actorId: org.admin.id,
    });
  });

  it("exports trash salesmen only when trash=1", async () => {
    const org = await seedOrg();
    deleteSalesmenMany([org.salesmanB.id], org.admin.id);
    const live = filteredSalesmen({ q: "", trash: false });
    const trash = filteredSalesmen({ q: "", trash: true });
    expect(live.some((r) => r.id === org.salesmanB.id)).toBe(false);
    expect(trash.some((r) => r.id === org.salesmanB.id)).toBe(true);
  });

  it("exports users with roles", async () => {
    const org = await seedOrg();
    const rows = filteredUsers({ q: "admin", trash: false });
    expect(rows.some((r) => r.id === org.admin.id)).toBe(true);
    expect(rows.find((r) => r.id === org.admin.id)?.roles.toLowerCase()).toContain("admin");

    const buf = await buildUserExportXlsx(rows, ["username", "roles"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.getWorksheet("User")!.getRow(1).getCell(1).value).toBe("Username");
  });

  it("exports the audit exports section after a list export is logged", async () => {
    const org = await seedOrg();
    logExport({
      listKey: "salesman",
      mode: "filtered",
      filters: { q: "", trash: false },
      rowCount: 1,
      columnKeys: ["nama"],
      actorId: org.admin.id,
    });
    const rows = filteredAuditRows({ section: "exports", q: "", entity: "" });
    expect(rows).toHaveLength(1);
    expect(rows[0].listKey).toBe("Salesman");

    const buf = await buildAuditExportXlsx("exports", rows, ["listKey", "mode", "rowCount"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Export")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("List");
    expect(sheet.getRow(2).getCell(1).value).toBe("Salesman");
    expect(sheet.getRow(2).getCell(3).value).toBe(1);
  });
});
