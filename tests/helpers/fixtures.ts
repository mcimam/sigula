import { eq } from "drizzle-orm";

import { hashPassword } from "~/lib/auth.server";
import { db, sqlite } from "~/db/client.server";
import { migrate } from "~/db/migrate.server";
import {
  customers,
  profiles,
  salesmen,
  supervisors,
  users,
} from "~/db/schema";

const TABLES = [
  "app_settings",
  "notification_deliveries",
  "notification_batches",
  "reason_logs",
  "status_logs",
  "mutation_logs",
  "transaksi",
  "order_history",
  "profiles",
  "customers",
  "salesmen",
  "supervisors",
  "users",
] as const;

/** Wipe all rows and ensure schema exists. Call in beforeEach. */
export function resetDb() {
  migrate();
  sqlite.exec("PRAGMA foreign_keys = OFF");
  for (const table of TABLES) {
    try {
      sqlite.exec(`DELETE FROM ${table}`);
    } catch {
      // table may not exist (e.g. order_history after migration)
    }
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
}

export async function seedOrg(opts?: {
  salesmanWa?: string;
  supervisorWa?: string;
}) {
  const passwordHash = await hashPassword("sigula123");

  const supervisor = db
    .insert(supervisors)
    .values({
      nama: "Budi Supervisor",
      nomorWa: opts?.supervisorWa ?? "628111111111",
    })
    .returning()
    .get();

  const salesman = db
    .insert(salesmen)
    .values({
      nama: "Andi Sales",
      nomorWa: opts?.salesmanWa ?? "628222222222",
      supervisorId: supervisor.id,
      status: "aktif",
    })
    .returning()
    .get();

  const salesmanB = db
    .insert(salesmen)
    .values({
      nama: "Citra Sales",
      nomorWa: "628333333333",
      supervisorId: supervisor.id,
      status: "aktif",
    })
    .returning()
    .get();

  const admin = db
    .insert(users)
    .values({
      username: "admin",
      passwordHash,
      displayName: "Admin",
    })
    .returning()
    .get();
  db.insert(profiles).values({ userId: admin.id, role: "admin" }).run();

  const salesmanUser = db
    .insert(users)
    .values({
      username: "salesman",
      passwordHash,
      displayName: "Andi",
    })
    .returning()
    .get();
  db.insert(profiles)
    .values({
      userId: salesmanUser.id,
      role: "salesman",
      salesmanId: salesman.id,
    })
    .run();

  return { supervisor, salesman, salesmanB, admin, salesmanUser };
}

export function addCustomer(opts: {
  salesmanId: number;
  nama: string;
  lastOrderDate?: string | null;
  orderCycleDays?: number;
  statusCustomer?: "aktif" | "inactive";
  notified?: boolean;
  tipeCustomer?: "lama" | "baru";
}) {
  return db
    .insert(customers)
    .values({
      nama: opts.nama,
      salesmanId: opts.salesmanId,
      tipeCustomer: opts.tipeCustomer ?? "lama",
      orderCycleDays: opts.orderCycleDays ?? 30,
      statusCustomer: opts.statusCustomer ?? "aktif",
      lastOrderDate: opts.lastOrderDate === undefined ? "2026-01-01" : opts.lastOrderDate,
      notified: opts.notified ?? false,
    })
    .returning()
    .get();
}

export function getCustomer(id: number) {
  return db.select().from(customers).where(eq(customers.id, id)).get()!;
}

/** Fixed "today" used across service tests unless overridden. */
export const TODAY = "2026-09-12";
