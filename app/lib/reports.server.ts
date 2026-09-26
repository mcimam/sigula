import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  customers,
  reasonLogs,
  REASON_LABELS,
  salesmen,
} from "~/db/schema";
import { daysSinceOrder, isOverdue, todayIso } from "~/lib/dates";
import { subordinateIds } from "~/lib/masterdata.server";

async function workbookBuffer(wb: ExcelJS.Workbook) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildSalesmanReminderReport(salesmanId: number) {
  const list = db
    .select()
    .from(customers)
    .where(eq(customers.salesmanId, salesmanId))
    .all()
    .filter((c) => c.notified)
    .map((c) => ({
      ...c,
      days: daysSinceOrder(c.lastOrderDate) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => b.days - a.days);

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Reminder");
  sheet.addRow(["Nama Konsumen", "Hari sejak order", "Siklus (hari)", "Status"]);
  for (const c of list) {
    sheet.addRow([
      c.nama,
      c.days === Number.POSITIVE_INFINITY ? "belum pernah" : c.days,
      c.orderCycleDays,
      c.statusCustomer,
    ]);
  }
  return workbookBuffer(wb);
}

/** `supervisorId` is the leading salesman; the team is every subordinate at any depth. */
export async function buildSupervisorTeamReport(supervisorId: number) {
  const teamIds = subordinateIds(supervisorId);
  const team =
    teamIds.length > 0
      ? db.select().from(salesmen).where(inArray(salesmen.id, teamIds)).all()
      : [];
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet("Ringkasan Salesman");
  summary.addRow(["Salesman", "Aktif", "Inactive", "Perlu follow-up"]);
  const detail = wb.addWorksheet("Detail Customer");
  detail.addRow([
    "Salesman",
    "Customer",
    "Status",
    "Hari sejak order",
    "Siklus",
    "Notified",
  ]);

  for (const sm of team) {
    const custs = db
      .select()
      .from(customers)
      .where(eq(customers.salesmanId, sm.id))
      .all();
    const aktif = custs.filter((c) => c.statusCustomer === "aktif").length;
    const inactive = custs.filter((c) => c.statusCustomer === "inactive").length;
    const followUp = custs.filter(
      (c) =>
        c.statusCustomer === "aktif" &&
        isOverdue(c.lastOrderDate, c.orderCycleDays),
    ).length;
    summary.addRow([sm.nama, aktif, inactive, followUp]);
    for (const c of custs) {
      const days = daysSinceOrder(c.lastOrderDate);
      detail.addRow([
        sm.nama,
        c.nama,
        c.statusCustomer,
        days ?? "belum pernah",
        c.orderCycleDays,
        c.notified ? "ya" : "tidak",
      ]);
    }
  }
  return workbookBuffer(wb);
}

export async function buildManagementSummaryReport() {
  const wb = new ExcelJS.Workbook();
  const perSup = wb.addWorksheet("Per Supervisor");
  perSup.addRow(["Supervisor", "Salesman", "Aktif", "Perlu follow-up"]);

  // Direct reports only: every salesman appears under exactly one supervisor.
  const allSalesmen = db.select().from(salesmen).all();
  const supervisorIds = new Set(
    allSalesmen.map((s) => s.supervisorId).filter((id): id is number => id != null),
  );
  for (const sup of allSalesmen.filter((s) => supervisorIds.has(s.id))) {
    const team = allSalesmen.filter((s) => s.supervisorId === sup.id);
    for (const sm of team) {
      const custs = db
        .select()
        .from(customers)
        .where(eq(customers.salesmanId, sm.id))
        .all();
      const aktif = custs.filter((c) => c.statusCustomer === "aktif").length;
      const followUp = custs.filter(
        (c) =>
          c.statusCustomer === "aktif" &&
          isOverdue(c.lastOrderDate, c.orderCycleDays),
      ).length;
      perSup.addRow([sup.nama, sm.nama, aktif, followUp]);
    }
  }

  const perSm = wb.addWorksheet("Per Salesman");
  perSm.addRow(["Salesman", "Alasan Terinput (all-time)", "Customer Aktif"]);
  for (const sm of db.select().from(salesmen).all()) {
    const reasons = db
      .select()
      .from(reasonLogs)
      .where(eq(reasonLogs.salesmanId, sm.id))
      .all().length;
    const aktif = db
      .select()
      .from(customers)
      .where(eq(customers.salesmanId, sm.id))
      .all()
      .filter((c) => c.statusCustomer === "aktif").length;
    perSm.addRow([sm.nama, reasons, aktif]);
  }

  const reasonsSheet = wb.addWorksheet("Alasan");
  reasonsSheet.addRow(["Kode", "Label", "Jumlah"]);
  const allReasons = db.select().from(reasonLogs).all();
  for (const code of ["1", "2", "3"] as const) {
    reasonsSheet.addRow([
      code,
      REASON_LABELS[code],
      allReasons.filter((r) => r.kodeAlasan === code).length,
    ]);
  }

  return workbookBuffer(wb);
}

export { todayIso };
