import ExcelJS from "exceljs";

import { daysSinceOrder } from "~/lib/dates";
import { followUpCountBySalesman, reasonCounts } from "~/lib/follow-ups.server";
import { liveCustomersOf, salesmenWithStats } from "~/lib/masterdata.server";
import { pendingCustomerIds } from "~/lib/pending.server";

async function workbookBuffer(wb: ExcelJS.Workbook) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildSalesmanReminderReport(salesmanId: number) {
  const pending = pendingCustomerIds();
  const list = liveCustomersOf(salesmanId)
    .filter((c) => pending.has(c.id))
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
  const pending = pendingCustomerIds();
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

  for (const sm of salesmenWithStats(supervisorId)) {
    summary.addRow([sm.nama, sm.aktif, sm.inactive, sm.followUp]);
    for (const c of liveCustomersOf(sm.id)) {
      const days = daysSinceOrder(c.lastOrderDate);
      detail.addRow([
        sm.nama,
        c.nama,
        c.statusCustomer,
        days ?? "belum pernah",
        c.orderCycleDays,
        pending.has(c.id) ? "ya" : "tidak",
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
  const allSalesmen = salesmenWithStats();
  const supervisorIds = new Set(
    allSalesmen.map((s) => s.supervisorId).filter((id): id is number => id != null),
  );
  for (const sup of allSalesmen.filter((s) => supervisorIds.has(s.id))) {
    for (const sm of allSalesmen.filter((s) => s.supervisorId === sup.id)) {
      perSup.addRow([sup.nama, sm.nama, sm.aktif, sm.followUp]);
    }
  }

  const perSm = wb.addWorksheet("Per Salesman");
  perSm.addRow(["Salesman", "Alasan Terinput (all-time)", "Customer Aktif"]);
  const followUps = followUpCountBySalesman();
  for (const sm of allSalesmen) {
    perSm.addRow([sm.nama, followUps.get(sm.id) ?? 0, sm.aktif]);
  }

  const reasonsSheet = wb.addWorksheet("Alasan");
  reasonsSheet.addRow(["Kode", "Label", "Jumlah"]);
  for (const r of reasonCounts()) reasonsSheet.addRow([r.code, r.label, r.count]);

  return workbookBuffer(wb);
}

