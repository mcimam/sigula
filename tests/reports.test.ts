import { beforeEach, describe, expect, it } from "vitest";

import ExcelJS from "exceljs";

import {
  buildManagementSummaryReport,
  buildSalesmanReminderReport,
  buildSupervisorTeamReport,
} from "~/lib/reports.server";
import { daysSinceOrder, todayIso } from "~/lib/dates";
import { submitReason } from "~/lib/follow-ups.server";

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
      pending: true,
    });
    addCustomer({
      salesmanId: salesman.id,
      nama: "Not Pending",
      lastOrderDate: "2026-01-01",
      pending: false,
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

  it("management summary always lists every reason, the salesman's-own-words one included", async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      pending: true,
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
    expect(codes).toEqual(["1", "2", "3", "other"]);
  });

  describe("the numbers in each sheet", () => {
    /** A small org with known figures: Andi has 1 overdue + 1 inactive, Citra 1 up-to-date, Andi's overdue one is pending. */
    async function scenario() {
      const { salesman, salesmanB, supervisor, salesmanUser } = await seedOrg();
      const overdue = addCustomer({ salesmanId: salesman.id, nama: "A1 overdue", lastOrderDate: "2026-01-01", pending: true });
      addCustomer({ salesmanId: salesman.id, nama: "A2 inactive", lastOrderDate: "2026-01-01", statusCustomer: "inactive" });
      const fresh = addCustomer({ salesmanId: salesmanB.id, nama: "C1 fresh", lastOrderDate: todayIso() });
      submitReason({ customerId: fresh.id, kodeAlasan: "2", actingUserId: salesmanUser.id });
      return { supervisor, salesman, overdue };
    }

    const rows = async (buf: Buffer, sheet: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
      const out: unknown[][] = [];
      wb.getWorksheet(sheet)!.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
      return out;
    };

    it("team report: per-salesman counts, and one detail row per customer with its pending flag", async () => {
      const { supervisor } = await scenario();
      const buf = await buildSupervisorTeamReport(supervisor.id);
      expect(await rows(buf, "Ringkasan Salesman")).toEqual([
        ["Salesman", "Aktif", "Inactive", "Perlu follow-up"],
        ["Andi Sales", 1, 1, 1],
        ["Citra Sales", 1, 0, 0],
      ]);
      expect(await rows(buf, "Detail Customer")).toEqual([
        ["Salesman", "Customer", "Status", "Hari sejak order", "Siklus", "Notified"],
        ["Andi Sales", "A1 overdue", "aktif", daysSinceOrder("2026-01-01"), 30, "ya"],
        ["Andi Sales", "A2 inactive", "inactive", daysSinceOrder("2026-01-01"), 30, "tidak"],
        ["Citra Sales", "C1 fresh", "aktif", 0, 30, "tidak"],
      ]);
    });

    it("team report of someone with no team is just the headers", async () => {
      const { salesman } = await scenario();
      const buf = await buildSupervisorTeamReport(salesman.id);
      expect(await rows(buf, "Ringkasan Salesman")).toHaveLength(1);
      expect(await rows(buf, "Detail Customer")).toHaveLength(1);
    });

    it("management report: direct reports per supervisor, reasons per salesman and per code", async () => {
      await scenario();
      const buf = await buildManagementSummaryReport();
      expect(await rows(buf, "Per Supervisor")).toEqual([
        ["Supervisor", "Salesman", "Aktif", "Perlu follow-up"],
        ["Budi Supervisor", "Andi Sales", 1, 1],
        ["Budi Supervisor", "Citra Sales", 1, 0],
      ]);
      expect(await rows(buf, "Per Salesman")).toEqual([
        ["Salesman", "Alasan Terinput (all-time)", "Customer Aktif"],
        ["Budi Supervisor", 0, 0],
        ["Andi Sales", 0, 1],
        ["Citra Sales", 1, 1],
      ]);
      expect(await rows(buf, "Alasan")).toEqual([
        ["Kode", "Label", "Jumlah"],
        ["1", "Kalah Harga", 0],
        ["2", "Stok Masih Ada", 1],
        ["3", "Sudah Bangkrut", 0],
        ["other", "Lainnya", 0],
      ]);
    });

    it("salesman report lists only that salesman's pending customers, most overdue first", async () => {
      const { salesman } = await scenario();
      const buf = await buildSalesmanReminderReport(salesman.id);
      expect(await rows(buf, "Reminder")).toEqual([
        ["Nama Konsumen", "Hari sejak order", "Siklus (hari)", "Status"],
        ["A1 overdue", daysSinceOrder("2026-01-01"), 30, "aktif"],
      ]);
    });
  });
});
