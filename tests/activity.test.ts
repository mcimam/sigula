import { beforeEach, describe, expect, it } from "vitest";

import { db } from "~/db/client.server";
import { activityLogs, customers, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { diffChanges, listActivityFor, listRecentActivity, logActivity } from "~/lib/activity.server";
import {
  createCustomer,
  createSalesman,
  createUserAccount,
  deleteCustomerRecord,
  deleteUserAccount,
  updateCustomer,
  updateSalesman,
  updateUserAccount,
} from "~/lib/masterdata.server";
import {
  createTransaksi,
  deleteTransaksi,
  listTransaksi,
  updateTransaksi,
} from "~/lib/orders.server";

import ExcelJS from "exceljs";

import { confirmImport } from "~/lib/imports.server";
import { submitReason } from "~/lib/reminders.server";

import { addCustomer, resetDb, seedOrg } from "./helpers/fixtures";

describe("activity log", () => {
  beforeEach(() => resetDb());

  it("diffChanges keeps only fields that changed", () => {
    expect(diffChanges({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: "" })).toEqual({
      b: { from: "x", to: "y" },
    });
  });

  it("an update that changed nothing is not recorded", async () => {
    const { admin } = await seedOrg();
    logActivity({
      entityType: "customer",
      entityId: 1,
      entityLabel: "X",
      action: "update",
      actorId: admin.id,
      changes: {},
    });
    expect(db.select().from(activityLogs).all()).toHaveLength(0);
  });

  it("records transaksi create / update / delete with the actor and readable values", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko A" });
    createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-01",
      catatan: "pertama",
      actingUserId: admin.id,
    });
    const row = listTransaksi()[0];

    updateTransaksi({
      id: row.id,
      customerId: c.id,
      salesmanId: salesmanB.id,
      tanggalOrder: "2026-08-02",
      catatan: "pertama",
      actingUserId: admin.id,
    });
    deleteTransaksi(row.id, admin.id);

    const trail = listActivityFor("transaksi", row.id);
    expect(trail.map((t) => t.action)).toEqual(["delete", "update", "create"]);
    expect(trail.every((t) => t.actorName === "Admin")).toBe(true);

    const update = trail[1];
    expect(update.changes.salesman).toEqual({ from: "Andi Sales", to: "Citra Sales" });
    expect(update.changes.tanggal_order).toEqual({ from: "2026-08-01", to: "2026-08-02" });
    expect(update.changes.catatan).toBeUndefined(); // unchanged → not listed

    expect(trail[2].entityLabel).toBe("Toko A · 2026-08-01");
    expect(trail[2].changes.customer).toEqual({ from: null, to: "Toko A" });
    expect(trail[0].changes.salesman).toEqual({ from: "Citra Sales", to: null });
  });

  it("customer edit that reassigns the salesman is one update with the salesman diff", async () => {
    const { admin, salesman, salesmanB } = await seedOrg();
    const c = createCustomer({
      nama: "Toko B",
      salesmanId: salesman.id,
      tipeCustomer: "baru",
      orderCycleDays: 30,
      actingUserId: admin.id,
    });
    updateCustomer({
      id: c.id,
      nama: "Toko B",
      salesmanId: salesmanB.id,
      tipeCustomer: "baru",
      statusCustomer: "aktif",
      orderCycleDays: 14,
      actingUserId: admin.id,
    });

    const [update, create] = listActivityFor("customer", c.id);
    expect(create.action).toBe("create");
    expect(update.action).toBe("update");
    expect(update.changes).toEqual({
      salesman: { from: "Andi Sales", to: "Citra Sales" },
      order_cycle_days: { from: 30, to: 14 },
    });
  });

  it("deleting a customer keeps its trail and notes how many transaksi went with it", async () => {
    const { admin, salesman } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko C" });
    createTransaksi({
      customerId: c.id,
      salesmanId: salesman.id,
      tanggalOrder: "2026-08-01",
      actingUserId: admin.id,
    });
    deleteCustomerRecord(c.id, admin.id);

    expect(db.select().from(customers).where(eq(customers.id, c.id)).all()).toHaveLength(0);
    const del = listActivityFor("customer", c.id)[0];
    expect(del.action).toBe("delete");
    expect(del.entityLabel).toBe("Toko C");
    expect(del.changes.transaksi_terhapus).toEqual({ from: 1, to: null });
  });

  it("salesman supervisor changes are logged by name", async () => {
    const { admin, salesman, supervisor } = await seedOrg();
    const s = createSalesman({ nama: "Baru", actingUserId: admin.id });
    updateSalesman({
      id: s.id,
      nama: "Baru",
      nomorWa: "6299",
      supervisorId: supervisor.id,
      status: "aktif",
      actingUserId: admin.id,
    });
    void salesman;
    const update = listActivityFor("salesman", s.id)[0];
    expect(update.changes).toEqual({
      nomor_wa: { from: null, to: "6299" },
      supervisor: { from: null, to: "Budi Supervisor" },
    });
  });

  it("never stores a password — only that it changed", async () => {
    const { admin } = await seedOrg();
    const u = await createUserAccount({
      username: "nina",
      displayName: "Nina",
      password: "rahasia-banget",
      role: "admin",
      actingUserId: admin.id,
    });
    await updateUserAccount({
      id: u.id,
      displayName: "Nina B",
      password: "lebih-rahasia",
      role: "admin",
      actingUserId: admin.id,
    });

    const raw = JSON.stringify(db.select().from(activityLogs).all());
    expect(raw).not.toContain("rahasia");
    expect(raw).not.toContain("passwordHash");
    const update = listActivityFor("user", u.id)[0];
    expect(update.changes.password).toEqual({ from: null, to: "(diubah)" });
    expect(update.changes.display_name).toEqual({ from: "Nina", to: "Nina B" });
  });

  it("the trail survives deleting both the record and the acting user", async () => {
    const { admin } = await seedOrg();
    const actor = await createUserAccount({
      username: "tmp",
      displayName: "Temp Admin",
      password: "x",
      role: "admin",
      actingUserId: admin.id,
    });
    const target = await createUserAccount({
      username: "target",
      displayName: "Target",
      password: "x",
      role: "admin",
      actingUserId: actor.id,
    });
    deleteUserAccount(target.id, actor.id);
    deleteUserAccount(actor.id, admin.id);

    expect(db.select().from(users).where(eq(users.id, actor.id)).all()).toHaveLength(0);
    const trail = listActivityFor("user", target.id);
    expect(trail.map((t) => t.action)).toEqual(["delete", "create"]);
    expect(trail[0].actorName).toBe("Temp Admin"); // snapshot, not a live join
  });

  it("listRecentActivity returns newest first across entities", async () => {
    const { admin, salesman } = await seedOrg();
    createCustomer({
      nama: "Z",
      salesmanId: salesman.id,
      tipeCustomer: "baru",
      orderCycleDays: 30,
      actingUserId: admin.id,
    });
    createSalesman({ nama: "Q", actingUserId: admin.id });
    const recent = listRecentActivity(10);
    expect(recent.map((r) => r.entityType)).toEqual(["salesman", "customer"]);
  });

  it('reason code "bangkrut" logs the customer going inactive; other codes log nothing', async () => {
    const { salesman, salesmanUser } = await seedOrg();
    const c1 = addCustomer({ salesmanId: salesman.id, nama: "Bangkrut" });
    const c2 = addCustomer({ salesmanId: salesman.id, nama: "MasihAda" });

    submitReason({ customerId: c2.id, kodeAlasan: "2", actingUserId: salesmanUser.id });
    submitReason({ customerId: c1.id, kodeAlasan: "3", actingUserId: salesmanUser.id });
    submitReason({ customerId: c1.id, kodeAlasan: "3", actingUserId: salesmanUser.id }); // already inactive

    expect(listActivityFor("customer", c2.id)).toHaveLength(0);
    const trail = listActivityFor("customer", c1.id);
    expect(trail).toHaveLength(1);
    expect(trail[0].changes.status_customer).toEqual({ from: "aktif", to: "inactive" });
    expect(trail[0].actorName).toBe("Andi");
  });

  it("Excel import logs the customers and salesmen it creates, and the transaksi via recordOrder", async () => {
    const { admin } = await seedOrg();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet Baru");
    ws.addRow(["Nama Konsumen", "Status (Lama/Baru)", "Tgl Terakhir Order"]);
    ws.addRow(["Toko Import", "Baru", "2026-08-01"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    await confirmImport({
      buffer,
      actingUserId: admin.id,
      treatUnknownSheetsAsNewSalesman: true,
    });

    const all = listRecentActivity(20);
    const kinds = all.map((a) => `${a.entityType}:${a.action}`).sort();
    expect(kinds).toEqual(["customer:create", "salesman:create", "transaksi:create"]);
    expect(all.every((a) => a.actorName === "Admin")).toBe(true);
  });
});
