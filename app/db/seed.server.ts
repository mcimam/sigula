import { eq } from "drizzle-orm";

import { hashPassword } from "~/lib/auth.server";
import { db, sqlite } from "~/db/client.server";
import { migrate } from "~/db/migrate.server";
import {
  customers,
  profiles,
  salesmen,
  users,
} from "~/db/schema";
import { todayIso } from "~/lib/dates";
import { recordOrder } from "~/lib/orders.server";

let seedPromise: Promise<{ seeded: boolean }> | null = null;

/** Demo seed — password for every role: `sigula123` */
export async function seedIfEmpty() {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeed() {
  migrate();

  // Serialize concurrent first-boot requests (root loader runs per request).
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.select().from(users).all();
    if (existing.length > 0) {
      sqlite.exec("COMMIT");
      return { seeded: false };
    }

    const passwordHash = await hashPassword("sigula123");
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return todayIso(d);
    };

    // ADR-0004: a supervisor is just a salesman with subordinates.
    const supervisor = db
      .insert(salesmen)
      .values({ nama: "Budi Supervisor", nomorWa: "628111111111", status: "aktif" })
      .returning()
      .get();

    const salesman = db
      .insert(salesmen)
      .values({
        nama: "Andi Sales",
        nomorWa: "628222222222",
        supervisorId: supervisor.id,
        status: "aktif",
      })
      .returning()
      .get();

    const adminUser = db
      .insert(users)
      .values({
        username: "admin",
        passwordHash,
        displayName: "Admin SiGula",
      })
      .returning()
      .get();
    db.insert(profiles).values({ userId: adminUser.id, role: "admin" }).run();

    const salesmanUser = db
      .insert(users)
      .values({
        username: "salesman",
        passwordHash,
        displayName: "Andi Sales",
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

    const supervisorUser = db
      .insert(users)
      .values({
        username: "supervisor",
        passwordHash,
        displayName: "Budi Supervisor",
      })
      .returning()
      .get();
    db.insert(profiles)
      .values({
        userId: supervisorUser.id,
        role: "supervisor",
        salesmanId: supervisor.id,
      })
      .run();

    const managementUser = db
      .insert(users)
      .values({
        username: "management",
        passwordHash,
        displayName: "Manajemen",
      })
      .returning()
      .get();
    db.insert(profiles)
      .values({ userId: managementUser.id, role: "management" })
      .run();

    const specs = [
      {
        nama: "Toko Maju (overdue)",
        tipe: "lama" as const,
        cycle: 30,
        last: daysAgo(45),
        status: "aktif" as const,
      },
      {
        nama: "Warung Sejahtera (on-cycle)",
        tipe: "lama" as const,
        cycle: 30,
        last: daysAgo(10),
        status: "aktif" as const,
      },
      {
        nama: "CV Baru (never ordered)",
        tipe: "baru" as const,
        cycle: 14,
        last: null as string | null,
        status: "aktif" as const,
      },
      {
        nama: "UD Bangkrut (inactive)",
        tipe: "lama" as const,
        cycle: 30,
        last: daysAgo(90),
        status: "inactive" as const,
      },
    ];

    for (const s of specs) {
      const c = db
        .insert(customers)
        .values({
          nama: s.nama,
          salesmanId: salesman.id,
          tipeCustomer: s.tipe,
          orderCycleDays: s.cycle,
          statusCustomer: s.status,
          lastOrderDate: s.last,
          notified: false,
        })
        .returning()
        .get();
      if (s.last) {
        recordOrder({
          customerId: c.id,
          actingUserId: adminUser.id,
          tanggalOrder: s.last,
          sumber: "seed",
        });
        if (s.status === "inactive") {
          db.update(customers)
            .set({ statusCustomer: "inactive", notified: false })
            .where(eq(customers.id, c.id))
            .run();
        }
      }
    }

    sqlite.exec("COMMIT");
    return { seeded: true };
  } catch (err) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}
