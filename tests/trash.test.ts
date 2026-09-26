import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, customers, salesmen, transaksi, users } from "~/db/schema";
import { verifyLogin } from "~/lib/auth.server";
import {
  createCustomer,
  createSalesman,
  createUserAccount,
  deleteCustomerRecord,
  deleteSalesman,
  deleteUserAccount,
  findLiveCustomer,
  salesmenWithStats,
  updateCustomer,
} from "~/lib/masterdata.server";
import {
  computeEligibleCustomers,
  createTransaksi,
  deleteTransaksi,
  listTransaksi,
  recordOrder,
} from "~/lib/orders.server";
import {
  countDeleted,
  listDeletedCustomers,
  listDeletedTransaksi,
  restoreCustomer,
  restoreCustomersMany,
  restoreSalesman,
  restoreSalesmenMany,
  restoreTransaksi,
  restoreUser,
} from "~/lib/trash.server";

import { addCustomer, getCustomer, resetDb, seedOrg, TODAY, logsFor } from "./helpers/fixtures";

const order = (customerId: number, salesmanId: number, tanggalOrder: string, actingUserId: number) => {
  createTransaksi({ customerId, salesmanId, tanggalOrder, actingUserId });
  return listTransaksi().find((t) => t.customerId === customerId && t.tanggalOrder === tanggalOrder)!;
};

describe("soft-deleted transaksi", () => {
  beforeEach(() => resetDb());

  it("disappears from the list and from last_order_date, and comes back on restore", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: null });
    order(c.id, salesman.id, "2026-08-01", admin.id);
    const newest = order(c.id, salesman.id, "2026-09-10", admin.id);
    expect(getCustomer(c.id).lastOrderDate).toBe("2026-09-10");

    deleteTransaksi(newest.id, admin.id);
    expect(listTransaksi().map((t) => t.id)).not.toContain(newest.id);
    expect(getCustomer(c.id).lastOrderDate).toBe("2026-08-01");
    const [gone] = listDeletedTransaksi();
    expect(gone).toMatchObject({ id: newest.id, customerNama: "Toko", deletedById: admin.id });
    expect(gone.deletedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    restoreTransaksi(newest.id, admin.id);
    expect(listTransaksi().map((t) => t.id)).toContain(newest.id);
    expect(getCustomer(c.id).lastOrderDate).toBe("2026-09-10");
    expect(listDeletedTransaksi()).toHaveLength(0);
  });

  it("logs the restore in the audit trail", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const t = order(c.id, salesman.id, "2026-08-01", admin.id);
    deleteTransaksi(t.id, admin.id);
    restoreTransaksi(t.id, admin.id);
    expect(logsFor("transaksi", t.id).map((a) => a.action)).toEqual(["restore", "delete", "create"]);
  });

  it("cannot be restored while its customer is still deleted", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const t = order(c.id, salesman.id, "2026-08-01", admin.id);
    deleteTransaksi(t.id, admin.id);
    deleteCustomerRecord(c.id, admin.id);
    expect(() => restoreTransaksi(t.id, admin.id)).toThrow(/masih terhapus/);
    expect(listTransaksi()).toHaveLength(0);
  });

  it("refuses to restore something that is not in the trash", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const t = order(c.id, salesman.id, "2026-08-01", admin.id);
    expect(() => restoreTransaksi(t.id)).toThrow(/tidak ada di daftar terhapus/);
  });
});

describe("soft-deleted customers", () => {
  beforeEach(() => resetDb());

  it("are invisible to eligibility, stats and new orders", async () => {
    const { salesman, supervisor, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Overdue", lastOrderDate: "2026-01-01" });
    expect(computeEligibleCustomers(TODAY)).toHaveLength(1);

    deleteCustomerRecord(c.id, admin.id);

    expect(computeEligibleCustomers(TODAY)).toHaveLength(0);
    expect(findLiveCustomer(c.id)).toBeUndefined();
    const andi = salesmenWithStats(supervisor.id).find((s) => s.id === salesman.id)!;
    expect(andi.aktif + andi.inactive).toBe(0);
    expect(() => recordOrder({ customerId: c.id, actingUserId: admin.id })).toThrow(/not found/);
    expect(() => updateCustomer({
      id: c.id, nama: "x", salesmanId: salesman.id, tipeCustomer: "lama",
      statusCustomer: "aktif", orderCycleDays: 30, actingUserId: admin.id,
    })).toThrow(/not found/);
  });

  it("take their live transaksi with them, and restore only those", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: null });
    const early = order(c.id, salesman.id, "2026-06-01", admin.id);
    order(c.id, salesman.id, "2026-07-01", admin.id);
    order(c.id, salesman.id, "2026-08-01", admin.id);
    deleteTransaksi(early.id, admin.id); // deleted on its own, before the customer

    deleteCustomerRecord(c.id, admin.id);
    expect(listTransaksi()).toHaveLength(0);
    expect(logsFor("customer", c.id)[0].changes.transaksi_terhapus).toEqual({ from: 2, to: null });

    restoreCustomer(c.id, admin.id);
    expect(listTransaksi().map((t) => t.tanggalOrder).sort()).toEqual(["2026-07-01", "2026-08-01"]);
    expect(listDeletedTransaksi().map((t) => t.id)).toEqual([early.id]); // still in the trash
    expect(getCustomer(c.id).lastOrderDate).toBe("2026-08-01");
    expect(logsFor("customer", c.id)[0]).toMatchObject({ action: "restore" });
    expect(logsFor("customer", c.id)[0].changes.transaksi_dipulihkan).toEqual({ from: null, to: 2 });
  });

  it("keep their assignment history, and it survives the round trip", async () => {
    const { salesman, salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    updateCustomer({
      id: c.id, nama: "Toko", salesmanId: salesmanB.id, tipeCustomer: "lama",
      statusCustomer: "aktif", orderCycleDays: 30, actingUserId: admin.id,
    });
    deleteCustomerRecord(c.id, admin.id);
    restoreCustomer(c.id, admin.id);
    expect(getCustomer(c.id).salesmanId).toBe(salesmanB.id);
  });

  it("free their name; restoring into a taken name is refused with a clear message", async () => {
    const { salesman, admin } = await seedOrg();
    const old = addCustomer({ salesmanId: salesman.id, nama: "Toko Maju" });
    deleteCustomerRecord(old.id, admin.id);
    createCustomer({ nama: "toko maju", salesmanId: salesman.id, tipeCustomer: "baru", orderCycleDays: 30 });
    expect(() => restoreCustomer(old.id, admin.id)).toThrow(/sudah ada untuk salesman/);
    expect(listDeletedCustomers().map((c) => c.id)).toEqual([old.id]);
  });

  it("cannot be restored while their salesman is deleted", async () => {
    const { salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesmanB.id, nama: "Toko" });
    deleteCustomerRecord(c.id, admin.id);
    deleteSalesman(salesmanB.id, admin.id);
    expect(() => restoreCustomer(c.id, admin.id)).toThrow(/salesman Citra Sales masih terhapus/);
    restoreSalesman(salesmanB.id, admin.id);
    expect(() => restoreCustomer(c.id, admin.id)).not.toThrow();
  });

  it("refuse a restore that would leave a live transaksi pointing at a deleted salesman", async () => {
    const { salesman, salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: null });
    // The order was recorded under Citra, who later hands the customer to Andi and is deleted.
    createTransaksi({ customerId: c.id, salesmanId: salesmanB.id, tanggalOrder: "2026-08-01", actingUserId: admin.id });
    deleteCustomerRecord(c.id, admin.id);
    deleteSalesman(salesmanB.id, admin.id);
    expect(() => restoreCustomer(c.id, admin.id)).toThrow(/pulihkan salesman itu dulu/);
  });

  it("a bulk restore is all-or-nothing", async () => {
    const { salesman, admin } = await seedOrg();
    const a = addCustomer({ salesmanId: salesman.id, nama: "A" });
    const b = addCustomer({ salesmanId: salesman.id, nama: "B" });
    deleteCustomerRecord(a.id, admin.id);
    deleteCustomerRecord(b.id, admin.id);
    createCustomer({ nama: "b", salesmanId: salesman.id, tipeCustomer: "baru", orderCycleDays: 30 }); // blocks B

    expect(() => restoreCustomersMany([a.id, b.id], admin.id)).toThrow(/sudah ada/);
    expect(listDeletedCustomers().map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(logsFor("customer", a.id).map((x) => x.action)).not.toContain("restore");
  });
});

describe("customer names", () => {
  beforeEach(() => resetDb());

  it("are unique per salesman ignoring case, but may repeat across salesmen", async () => {
    const { salesman, salesmanB } = await seedOrg();
    createCustomer({ nama: "Toko Maju", salesmanId: salesman.id, tipeCustomer: "lama", orderCycleDays: 30 });
    expect(() =>
      createCustomer({ nama: "TOKO MAJU", salesmanId: salesman.id, tipeCustomer: "lama", orderCycleDays: 30 }),
    ).toThrow(/sudah ada untuk salesman Andi Sales/);
    expect(() =>
      createCustomer({ nama: "Toko Maju", salesmanId: salesmanB.id, tipeCustomer: "lama", orderCycleDays: 30 }),
    ).not.toThrow();
  });

  it("clash is caught before a customer is moved to a salesman who already has that name", async () => {
    const { salesman, salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    addCustomer({ salesmanId: salesmanB.id, nama: "toko" });
    expect(() =>
      updateCustomer({
        id: c.id, nama: "Toko", salesmanId: salesmanB.id, tipeCustomer: "lama",
        statusCustomer: "aktif", orderCycleDays: 30, actingUserId: admin.id,
      }),
    ).toThrow(/sudah ada untuk salesman Citra Sales/);
    expect(getCustomer(c.id).salesmanId).toBe(salesman.id); // nothing half-applied
  });
});

describe("soft-deleted salesmen", () => {
  beforeEach(() => resetDb());

  it("are blocked only by live customers — deleted ones no longer count", async () => {
    const { salesmanB, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesmanB.id, nama: "Toko" });
    expect(() => deleteSalesman(salesmanB.id, admin.id)).toThrow(/masih punya 1 customer/);
    deleteCustomerRecord(c.id, admin.id);
    expect(() => deleteSalesman(salesmanB.id, admin.id)).not.toThrow();
    expect(db.select().from(salesmen).where(eq(salesmen.id, salesmanB.id)).get()!.deletedAt).not.toBeNull();
  });

  it("lock their linked user out until restored", async () => {
    const { salesman, admin } = await seedOrg();
    expect((await verifyLogin("salesman", "sigula123"))?.username).toBe("salesman");
    // Andi has a login; drop everything that blocks deleting him.
    deleteSalesman(salesman.id, admin.id);
    expect(await verifyLogin("salesman", "sigula123")).toBeNull();
    restoreSalesman(salesman.id, admin.id);
    expect((await verifyLogin("salesman", "sigula123"))?.username).toBe("salesman");
  });

  it("cannot be restored while their supervisor is deleted; a batch restores supervisors first", async () => {
    const { supervisor, salesman, salesmanB, admin } = await seedOrg();
    deleteSalesman(salesmanB.id, admin.id);
    deleteSalesman(salesman.id, admin.id);
    deleteSalesman(supervisor.id, admin.id);
    expect(() => restoreSalesman(salesman.id, admin.id)).toThrow(/atasannya \(Budi Supervisor\) masih terhapus/);

    // Listed child-first on purpose.
    restoreSalesmenMany([salesman.id, salesmanB.id, supervisor.id], admin.id);
    expect(db.select().from(salesmen).where(alive(salesmen)).all()).toHaveLength(3);
  });

  it("are not offered as a supervisor or a hierarchy member", async () => {
    const { supervisor, salesman, salesmanB, admin } = await seedOrg();
    deleteSalesman(salesmanB.id, admin.id);
    expect(() => createSalesman({ nama: "Baru", supervisorId: salesmanB.id })).toThrow(/tidak ditemukan/);
    expect(salesmenWithStats(supervisor.id).map((s) => s.id)).toEqual([salesman.id]);
  });
});

describe("soft-deleted users", () => {
  beforeEach(() => resetDb());

  it("cannot sign in, free their username, and cannot come back into a taken one", async () => {
    const { admin } = await seedOrg();
    const first = await createUserAccount({
      username: "budi", displayName: "Budi", password: "password-1", roles: ["admin"], actingUserId: admin.id,
    });
    expect((await verifyLogin("budi", "password-1"))?.id).toBe(first.id);

    deleteUserAccount(first.id, admin.id);
    expect(await verifyLogin("budi", "password-1")).toBeNull();
    expect(countDeleted().user).toBe(1);

    const second = await createUserAccount({
      username: "budi", displayName: "Budi 2", password: "password-2", roles: ["admin"], actingUserId: admin.id,
    });
    expect(second.id).not.toBe(first.id);
    expect(() => restoreUser(first.id, admin.id)).toThrow(/sudah dipakai/);

    deleteUserAccount(second.id, admin.id);
    restoreUser(first.id, admin.id);
    expect((await verifyLogin("budi", "password-1"))?.id).toBe(first.id);
    expect(db.select().from(users).where(alive(users)).all().map((u) => u.username)).toContain("budi");
  });

  it("rejects a duplicate username among live accounts with a readable message", async () => {
    const { admin } = await seedOrg();
    await expect(
      createUserAccount({ username: "admin", displayName: "Dup", password: "password-x", roles: ["admin"], actingUserId: admin.id }),
    ).rejects.toThrow(/Username "admin" sudah dipakai/);
  });
});

describe("countDeleted", () => {
  beforeEach(() => resetDb());

  it("counts each trash separately", async () => {
    const { salesman, admin } = await seedOrg();
    const c = addCustomer({ salesmanId: salesman.id, nama: "Toko" });
    const t = order(c.id, salesman.id, "2026-08-01", admin.id);
    expect(countDeleted()).toEqual({ transaksi: 0, customer: 0, salesman: 0, user: 0 });
    deleteTransaksi(t.id, admin.id);
    expect(countDeleted().transaksi).toBe(1);
    deleteCustomerRecord(c.id, admin.id);
    expect(countDeleted()).toMatchObject({ customer: 1, transaksi: 1 });
    expect(db.select().from(transaksi).all()).toHaveLength(1);
    expect(db.select().from(customers).all()).toHaveLength(1);
  });
});
