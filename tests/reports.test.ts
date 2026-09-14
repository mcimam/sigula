import { beforeEach, describe, expect, it } from "vitest";

import ExcelJS from "exceljs";

import {
  buildManagementSummaryReport,
  buildSalesmanReminderReport,
  buildSupervisorTeamReport,
} from "~/lib/reports.server";
import { submitReason } from "~/lib/reminders.server";

import {
  addCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

async function sheetNames(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb.worksheets.map((s) => s.name);
}

describe("Excel reports (FR-22–FR-24)", () => {
  beforeEach(() => resetDb());

  it("salesman reminder report only lists notified customers", async () => {
    const { salesman } = await seedOrg();
    addCustomer({
      salesmanId: salesman.id,
      nama: "Pending A",
      lastOrderDate: "2026-01-01",
      notified: true,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Not Pending",
      lastOrderDate: "2026-01-01",
      notified: false,
    });
    const buf = await buildSalesmanReminderReport(salesman.id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const sheet = wb.getWorksheet("Reminder")!;
    const names: string[] = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      names.push(String(row.getCell(1).value));
    });
    expect(names).toEqual(["Pending A"]);
  });

  it("supervisor team report has summary + detail sheets scoped to the team", async () => {
    const { salesman, supervisor } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const buf = await buildSupervisorTeamReport(supervisor.id);
    expect(await sheetNames(buf)).toEqual([
      "Ringkasan Salesman",
      "Detail Customer",
    ]);
  });

  it("management summary always lists all three reason codes", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      notified: true,
    });
    submitReason({
      customerId: c.id,
      kodeAlasan: "1",
      actingUserId: salesmanUser.id,
    });

    const buf = await buildManagementSummaryReport();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Per Supervisor",
      "Per Salesman",
      "Alasan",
    ]);
    const alasan = wb.getWorksheet("Alasan")!;
    const codes: string[] = [];
    alasan.eachRow((row, n) => {
      if (n === 1) return;
      codes.push(String(row.getCell(1).value));
    });
    expect(codes).toEqual(["1", "2", "3"]);
  });
});
