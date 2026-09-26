import { eq } from "drizzle-orm";

import { hashPassword } from "~/lib/auth.server";
import { db, sqlite } from "~/db/client.server";
import { customers, salesmen, users } from "~/db/schema";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { todayIso } from "~/lib/dates";
import { assertPasswordAcceptable, insertCustomer } from "~/lib/masterdata.server";
import { roleIdsByCode, setUserRoles } from "~/lib/roles.server";
import { recordOrder } from "~/lib/orders.server";

let seedPromise: Promise<{ seeded: boolean }> | null = null;

/**
 * First boot on an empty database. Outside production: a demo organisation whose four accounts
 * share the published password `sigula123`. **In production none of that**: demo accounts with a
 * public password must never exist there, so an empty production database gets one administrator,
 * and only if the operator supplies the password (`ADMIN_PASSWORD`, optionally `ADMIN_USERNAME`);
 * without it nothing is seeded and the log says why.
 */
export async function seedIfEmpty() {
  if (!seedPromise) {
    seedPromise = seedDatabase({
      production: process.env.NODE_ENV === "production",
      adminUsername: process.env.ADMIN_USERNAME,
      adminPassword: process.env.ADMIN_PASSWORD,
    }).catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

export async function seedDatabase(opts: { production: boolean; adminUsername?: string; adminPassword?: string }) {
  return opts.production ? seedFirstAdmin(opts) : runSeed();
}

/** The one account a production install starts with. Only when the database has no users at all. */
async function seedFirstAdmin(opts: { adminUsername?: string; adminPassword?: string }) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    if (db.select().from(users).all().length > 0) {
      sqlite.exec("COMMIT");
      return { seeded: false };
    }
    const password = opts.adminPassword ?? "";
    try {
      assertPasswordAcceptable(password);
    } catch (err) {
      sqlite.exec("COMMIT");
      console.error(
        `[sigula] Database kosong dan tidak ada admin pertama: set ADMIN_PASSWORD (dan bila perlu ADMIN_USERNAME) lalu jalankan ulang. ${err instanceof Error ? err.message : ""}`,
      );
      return { seeded: false };
    }
    const user = db
      .insert(users)
      .values({
        username: (opts.adminUsername ?? "").trim() || "admin",
        passwordHash: await hashPassword(password),
        displayName: "Administrator",
      })
      .returning()
      .get();
    setUserRoles(db, user.id, roleIdsByCode(["admin"]), null);
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

async function runSeed() {
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
      .values({ nama: "Budi Supervisor", status: "aktif" })
      .returning()
      .get();
    setWhatsappNumber(supervisor.id, "628111111111");

    const salesman = db
      .insert(salesmen)
      .values({
        nama: "Andi Sales",
        supervisorId: supervisor.id,
        status: "aktif",
      })
      .returning()
      .get();
    setWhatsappNumber(salesman.id, "628222222222");

    const makeUser = (
      username: string,
      displayName: string,
      roleCode: string,
      salesmanId: number | null = null,
    ) => {
      const user = db
        .insert(users)
        .values({ username, passwordHash, displayName, salesmanId })
        .returning()
        .get();
      setUserRoles(db, user.id, roleIdsByCode([roleCode]), null);
      return user;
    };
    const adminUser = makeUser("admin", "Admin SiGula", "admin");
    makeUser("salesman", "Andi Sales", "salesman", salesman.id);
    makeUser("supervisor", "Budi Supervisor", "supervisor", supervisor.id);
    makeUser("management", "Manajemen", "management");

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
      const c = insertCustomer(
        {
          nama: s.nama,
          salesmanId: salesman.id,
          tipeCustomer: s.tipe,
          orderCycleDays: s.cycle,
          statusCustomer: s.status,
          lastOrderDate: s.last,
        },
        adminUser.id,
      );
      if (s.last) {
        recordOrder({
          customerId: c.id,
          actingUserId: adminUser.id,
          tanggalOrder: s.last,
          sumber: "seed",
        });
        if (s.status === "inactive") {
          db.update(customers)
            .set({ statusCustomer: "inactive" })
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
