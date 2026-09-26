import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/db/client.server";
import { customers, salesmen, userRoles, users } from "~/db/schema";
import { seedDatabase } from "~/db/seed.server";
import { verifyLogin } from "~/lib/auth.server";
import { createUserAccount } from "~/lib/masterdata.server";

import { grantsOf, resetDb } from "./helpers/fixtures";

const userNames = () => db.select().from(users).all().map((u) => u.username).sort();

describe("first boot on an empty database", () => {
  beforeEach(() => resetDb());

  describe("outside production", () => {
    it("seeds the demo organisation: four accounts sharing the published demo password", async () => {
      expect(await seedDatabase({ production: false })).toEqual({ seeded: true });

      expect(userNames()).toEqual(["admin", "management", "salesman", "supervisor"]);
      expect((await verifyLogin("admin", "sigula123"))?.username).toBe("admin");
      expect(db.select().from(customers).all().length).toBeGreaterThan(0);
    });

    it("does nothing when there are users already", async () => {
      await seedDatabase({ production: false });
      const before = db.select().from(users).all().length;
      expect(await seedDatabase({ production: false })).toEqual({ seeded: false });
      expect(db.select().from(users).all()).toHaveLength(before);
    });
  });

  describe("in production", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    beforeEach(() => error.mockClear());

    it("never creates the demo accounts or demo data — nobody can sign in with the published password", async () => {
      await seedDatabase({ production: true, adminPassword: "kata-sandi-panjang" });

      expect(userNames()).toEqual(["admin"]);
      expect(await verifyLogin("admin", "sigula123")).toBeNull();
      expect(await verifyLogin("salesman", "sigula123")).toBeNull();
      expect(db.select().from(customers).all()).toHaveLength(0);
      expect(db.select().from(salesmen).all()).toHaveLength(0);
    });

    it("creates one administrator from the password the operator supplies", async () => {
      expect(await seedDatabase({ production: true, adminPassword: "kata-sandi-panjang", adminUsername: "  pemilik " })).toEqual({ seeded: true });

      const [admin] = db.select().from(users).all();
      expect(admin).toMatchObject({ username: "pemilik", displayName: "Administrator", isActive: true });
      expect((await verifyLogin("pemilik", "kata-sandi-panjang"))?.id).toBe(admin.id);
      expect(db.select().from(userRoles).all()).toHaveLength(1);
      expect((await grantsOf(admin.id)).permissions["masterdata.manage"]).toBe("all");
    });

    it("the username defaults to 'admin'", async () => {
      await seedDatabase({ production: true, adminPassword: "kata-sandi-panjang" });
      expect(userNames()).toEqual(["admin"]);
    });

    it("without a usable password nothing is seeded, and the log says what to set", async () => {
      for (const adminPassword of [undefined, "", "pendek", "sigula123"]) {
        expect(await seedDatabase({ production: true, adminPassword }), String(adminPassword)).toEqual({ seeded: false });
      }
      expect(db.select().from(users).all()).toHaveLength(0);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("ADMIN_PASSWORD"));
    });

    it("leaves a database that has users alone, whatever the environment says", async () => {
      await createUserAccount({ username: "ada", displayName: "Ada", password: "kata-sandi-1", roles: ["admin"], actingUserId: null });
      expect(await seedDatabase({ production: true, adminPassword: "kata-sandi-panjang" })).toEqual({ seeded: false });
      expect(userNames()).toEqual(["ada"]);
    });
  });
});
