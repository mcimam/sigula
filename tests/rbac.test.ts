import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { permissions, salesmen, userRoles, users } from "~/db/schema";
import { assertInTeamOrAll, assertOwnOrAll, requireSalesmanId } from "~/lib/access.server";
import {
  getAuthUser,
  hashPassword,
  recordLogin,
  requirePermission,
  verifyLogin,
  type AuthUser,
} from "~/lib/auth.server";
import {
  createUserAccount,
  deleteSalesman,
  deleteUserAccount,
  updateUserAccount,
} from "~/lib/masterdata.server";
import { can, homeFor, mergeGrants, PERM, scopeOf, type PermissionMap } from "~/lib/permissions";
import { listRoles, rolesNeedingSalesman, roleIdsByCode } from "~/lib/roles.server";
import { restoreUser } from "~/lib/trash.server";

import { createUser, grantsOf, logsFor, requestAs, resetDb, seedOrg } from "./helpers/fixtures";

/** What each built-in role could reach before RBAC (`profiles.role`), permission by permission. */
const EXPECTED: Record<string, PermissionMap> = {
  admin: {
    "admin.dashboard": "all", "notification.manage": "all", "transaksi.manage": "all",
    "masterdata.manage": "all", "audit.read": "all", "settings.manage": "all",
    "report.salesman": "all", "report.team": "all", "report.management": "all",
  },
  salesman: { "customer.follow_up": "own", "report.salesman": "own" },
  supervisor: { "team.read": "team", "customer.reactivate": "team", "report.team": "team" },
  management: { "management.read": "all", "report.management": "all" },
};

describe("the permission catalogue", () => {
  beforeEach(() => resetDb());

  it("the codes in permissions.ts and the seeded permissions table are the same set", () => {
    const seeded = db.select({ code: permissions.code }).from(permissions).all().map((p) => p.code).sort();
    expect(seeded).toEqual(Object.values(PERM).sort());
  });

  it("the four built-in roles grant exactly what each old profile role could reach", async () => {
    const { supervisor } = await seedOrg();
    expect(listRoles().map((r) => r.code)).toEqual(["admin", "salesman", "supervisor", "management"]);
    for (const [role, expected] of Object.entries(EXPECTED)) {
      const u = createUser(`u-${role}`, role, [role], role === "salesman" || role === "supervisor" ? supervisor.id : null);
      expect((await grantsOf(u.id)).permissions, role).toEqual(expected);
    }
  });

  it("merging roles keeps the widest scope per permission", () => {
    expect(
      mergeGrants([
        { code: "report.salesman", scope: "own" },
        { code: "report.salesman", scope: "all" },
        { code: "team.read", scope: "team" },
        { code: "team.read", scope: "own" },
      ]),
    ).toEqual({ "report.salesman": "all", "team.read": "team" });
  });

  it("the landing page is the first area the user can open, admin first", () => {
    const has = (...codes: (typeof PERM)[keyof typeof PERM][]) =>
      ({ permissions: Object.fromEntries(codes.map((c) => [c, "all"])) }) as { permissions: PermissionMap };
    expect(homeFor(has(PERM.customerFollowUp, PERM.adminDashboard))).toBe("/admin/dashboard");
    expect(homeFor(has(PERM.customerFollowUp, PERM.teamRead))).toBe("/supervisor");
    expect(homeFor(has(PERM.managementRead, PERM.teamRead))).toBe("/management");
    expect(homeFor(has(PERM.customerFollowUp))).toBe("/salesman");
    expect(homeFor(has())).toBeNull();
  });
});

describe("signing in and out of access", () => {
  beforeEach(() => resetDb());

  it("a user's access is the union of their roles, with the widest scope", async () => {
    const { salesman } = await seedOrg();
    const both = createUser("both", "Both", ["admin", "salesman"], salesman.id);
    const g = await grantsOf(both.id);
    expect(g.roleNames).toEqual(["Admin", "Salesman"]);
    expect(scopeOf(g, PERM.reportSalesman)).toBe("all"); // admin's `all` beats salesman's `own`
    expect(scopeOf(g, PERM.customerFollowUp)).toBe("own");
    expect(can(g, PERM.auditRead)).toBe(true);
    expect(g.salesmanId).toBe(salesman.id);
  });

  it("a user with no roles signs in but can do nothing", async () => {
    await seedOrg();
    const nobody = createUser("nobody", "Nobody", []);
    const g = await grantsOf(nobody.id);
    expect(g.permissions).toEqual({});
    expect(g.roleNames).toEqual([]);
    expect(homeFor(g)).toBeNull();
  });

  it("an inactive, deleted, or salesman-less-by-deletion user has no session", async () => {
    const { admin, salesman, salesmanUser } = await seedOrg();
    const req = await requestAs(salesmanUser.id);
    expect(await getAuthUser(req)).not.toBeNull();

    db.update(users).set({ isActive: false }).where(eq(users.id, salesmanUser.id)).run();
    expect(await getAuthUser(req)).toBeNull();
    expect(await verifyLogin("salesman", "sigula123")).toBeNull();
    db.update(users).set({ isActive: true }).where(eq(users.id, salesmanUser.id)).run();
    expect(await getAuthUser(req)).not.toBeNull();

    deleteSalesman(salesman.id, admin.id); // the linked salesman goes away
    expect(await getAuthUser(req)).toBeNull();
    expect(await verifyLogin("salesman", "sigula123")).toBeNull();
  });

  it("records the last sign-in", async () => {
    const { admin } = await seedOrg();
    expect(db.select().from(users).where(eq(users.id, admin.id)).get()!.lastLoginAt).toBeNull();
    recordLogin(admin.id);
    expect(db.select().from(users).where(eq(users.id, admin.id)).get()!.lastLoginAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("requirePermission lets the holder in, refuses others with 403, and sends the anonymous to login", async () => {
    const { admin, salesmanUser } = await seedOrg();
    expect((await requirePermission(await requestAs(admin.id), PERM.settingsManage)).id).toBe(admin.id);

    const refused = await requirePermission(await requestAs(salesmanUser.id), PERM.settingsManage).catch((e) => e);
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(403);

    const anonymous = await requirePermission(new Request("http://localhost/x"), PERM.settingsManage).catch((e) => e);
    expect((anonymous as Response).status).toBe(302);
    expect((anonymous as Response).headers.get("Location")).toContain("/login");
  });
});

describe("what scope reaches", () => {
  beforeEach(() => resetDb());
  const asUser = (over: Partial<AuthUser>): AuthUser => ({
    id: 1, username: "u", displayName: "U", roleNames: [], permissions: {}, salesmanId: null, ...over,
  });
  const status = (fn: () => void) => {
    try { fn(); return 200; } catch (e) { return (e as Response).status; }
  };

  it("`all` reaches anyone; `own` and `team` reach only the user's own salesman for reports", () => {
    const own = asUser({ salesmanId: 7, permissions: { "report.salesman": "own" } });
    expect(status(() => assertOwnOrAll(own, PERM.reportSalesman, 7))).toBe(200);
    expect(status(() => assertOwnOrAll(own, PERM.reportSalesman, 8))).toBe(403);
    expect(status(() => assertOwnOrAll(asUser({ permissions: { "report.salesman": "all" } }), PERM.reportSalesman, 8))).toBe(200);
    expect(status(() => assertOwnOrAll(asUser({ salesmanId: 7 }), PERM.reportSalesman, 7))).toBe(403); // no permission at all
    expect(status(() => assertOwnOrAll(asUser({ permissions: { "report.salesman": "own" } }), PERM.reportSalesman, 7))).toBe(403); // no salesman
  });

  it("`team` reaches subordinates at any depth but not the user, and never a stranger", async () => {
    const { supervisor, salesman, salesmanB } = await seedOrg();
    const under = db.insert(salesmen).values({ nama: "Cucu", supervisorId: salesman.id }).returning().get();
    const boss = asUser({ salesmanId: supervisor.id, permissions: { "team.read": "team" } });
    for (const id of [salesman.id, salesmanB.id, under.id]) expect(status(() => assertInTeamOrAll(boss, PERM.teamRead, id))).toBe(200);
    expect(status(() => assertInTeamOrAll(boss, PERM.teamRead, supervisor.id))).toBe(403); // not oneself
    expect(status(() => assertInTeamOrAll(asUser({ salesmanId: salesman.id, permissions: { "team.read": "team" } }), PERM.teamRead, salesmanB.id))).toBe(403);
    expect(status(() => assertInTeamOrAll(asUser({ salesmanId: 1, permissions: { "team.read": "own" } }), PERM.teamRead, salesman.id))).toBe(403);
  });

  it("a team/own role without a linked salesman is refused instead of reading as 'everyone'", () => {
    expect(status(() => requireSalesmanId(asUser({ salesmanId: null })))).toBe(403);
    expect(requireSalesmanId(asUser({ salesmanId: 3 }))).toBe(3);
  });
});

describe("passwords an admin may set", () => {
  beforeEach(() => resetDb());
  const base = { displayName: "Y", roles: ["admin"], actingUserId: null };

  it("are at least 8 characters and never the published demo password — for a new account", async () => {
    for (const password of ["", "1234567", "sigula123"]) {
      await expect(createUserAccount({ ...base, username: "baru", password }), password).rejects.toThrow(/Password/);
    }
    expect(db.select().from(users).all()).toHaveLength(0);

    await createUserAccount({ ...base, username: "baru", password: "12345678" }); // exactly the minimum
    expect((await verifyLogin("baru", "12345678"))?.username).toBe("baru");
  });

  it("and when it is changed; leaving the field blank keeps the old one", async () => {
    await createUserAccount({ ...base, username: "budi", password: "kata-sandi-1" });
    const id = db.select().from(users).all()[0].id;
    const edit = (password: string) => updateUserAccount({ id, displayName: "Y", password, roles: ["admin"], isActive: true, actingUserId: null });

    await expect(edit("pendek")).rejects.toThrow(/minimal 8/);
    await expect(edit("sigula123")).rejects.toThrow(/terlalu umum/);
    await edit(""); // blank = unchanged
    expect((await verifyLogin("budi", "kata-sandi-1"))?.id).toBe(id);

    await edit("kata-sandi-2");
    expect(await verifyLogin("budi", "kata-sandi-1")).toBeNull();
    expect((await verifyLogin("budi", "kata-sandi-2"))?.id).toBe(id);
  });
});

describe("creating and editing users with roles", () => {
  beforeEach(() => resetDb());
  const base = { displayName: "X", password: "password-pw", actingUserId: null };

  it("needs at least one role, and every code must exist", async () => {
    await seedOrg();
    await expect(createUserAccount({ ...base, username: "a", roles: [] })).rejects.toThrow(/minimal satu role/);
    await expect(createUserAccount({ ...base, username: "a", roles: ["dukun"] })).rejects.toThrow(/Role tidak dikenal: dukun/);
  });

  it("a role that reads salesman data needs a salesman — and says which role", async () => {
    const { salesman } = await seedOrg();
    await expect(createUserAccount({ ...base, username: "s", roles: ["salesman"] })).rejects.toThrow(/Pilih salesman untuk role Salesman/);
    await expect(createUserAccount({ ...base, username: "s", roles: ["supervisor"], salesmanId: 99999 })).rejects.toThrow(/Salesman tidak ditemukan/);
    const ok = await createUserAccount({ ...base, username: "s", roles: ["salesman", "supervisor"], salesmanId: salesman.id });
    expect((await grantsOf(ok.id)).salesmanId).toBe(salesman.id);
  });

  it("drops the salesman link when no chosen role needs one", async () => {
    const { salesman } = await seedOrg();
    const admin2 = await createUserAccount({ ...base, username: "adm", roles: ["admin"], salesmanId: salesman.id });
    expect(db.select().from(users).where(eq(users.id, admin2.id)).get()!.salesmanId).toBeNull();
    expect(rolesNeedingSalesman(roleIdsByCode(["admin", "management"]))).toEqual([]);
    expect(rolesNeedingSalesman(roleIdsByCode(["admin", "salesman"])).map((r) => r.code)).toEqual(["salesman"]);
  });

  it("an inactive account is created but cannot sign in", async () => {
    await seedOrg();
    await createUserAccount({ ...base, username: "off", password: "password-off", roles: ["admin"], isActive: false });
    expect(await verifyLogin("off", "password-off")).toBeNull();
  });

  it("changing roles adds and removes exactly the difference, and the audit trail names the roles", async () => {
    const { admin, salesman } = await seedOrg();
    const u = await createUserAccount({ ...base, username: "multi", roles: ["salesman"], salesmanId: salesman.id, actingUserId: admin.id });
    await updateUserAccount({ id: u.id, displayName: "X", roles: ["salesman", "management"], salesmanId: salesman.id, isActive: true, actingUserId: admin.id });
    let held = db.select().from(userRoles).where(eq(userRoles.userId, u.id)).all();
    expect(held).toHaveLength(2);
    expect(held.find((r) => r.grantedById === admin.id)).toBeDefined();

    await updateUserAccount({ id: u.id, displayName: "X", roles: ["management"], salesmanId: null, isActive: false, actingUserId: admin.id });
    held = db.select().from(userRoles).where(eq(userRoles.userId, u.id)).all();
    expect(held).toHaveLength(1);
    const [latest, middle] = logsFor("user", u.id);
    expect(middle.changes.roles).toEqual({ from: "Salesman", to: "Management, Salesman" });
    expect(latest.changes).toMatchObject({
      roles: { from: "Management, Salesman", to: "Management" },
      is_active: { from: "Aktif", to: "Nonaktif" },
      salesman: { from: "Andi Sales", to: null },
    });
  });

  it("nobody can remove, deactivate or delete the last account that manages master data", async () => {
    const { admin } = await seedOrg();
    const edit = (over: Partial<Parameters<typeof updateUserAccount>[0]>) =>
      updateUserAccount({ id: admin.id, displayName: "Admin", roles: ["admin"], isActive: true, actingUserId: admin.id, ...over });
    await expect(edit({ roles: ["management"] })).rejects.toThrow(/satu-satunya akun/);
    await expect(edit({ isActive: false })).rejects.toThrow(/satu-satunya akun/);
    expect(() => deleteUserAccount(admin.id, admin.id)).toThrow(/satu-satunya akun/);
    await expect(edit({ displayName: "Renamed" })).resolves.toBeUndefined(); // harmless edits still work

    // Once a second administrator exists, the first can step down.
    await createUserAccount({ ...base, username: "adm2", roles: ["admin"] });
    await expect(edit({ roles: ["management"] })).resolves.toBeUndefined();
  });

  it("a deleted user comes back with the roles they had", async () => {
    const { admin, salesman } = await seedOrg();
    const u = await createUserAccount({ ...base, username: "back", roles: ["salesman"], salesmanId: salesman.id, actingUserId: admin.id });
    deleteUserAccount(u.id, admin.id);
    expect(await getAuthUser(await requestAs(u.id))).toBeNull();
    restoreUser(u.id, admin.id);
    expect((await grantsOf(u.id)).roleNames).toEqual(["Salesman"]);
    expect(logsFor("user", u.id)[0].changes.roles).toEqual({ from: null, to: "Salesman" });
    expect(await hashPassword("x")).toBeTruthy();
  });
});
