import { and, eq, inArray, sql } from "drizzle-orm";

import { db, type DbHandle } from "~/db/client.server";
import { permissions, rolePermissions, roles, userRoles } from "~/db/schema";
import { PERM, type PermissionCode } from "~/lib/permissions";

/**
 * Roles and who holds them (ADR-0007). Roles and permissions are reference data;
 * this module reads them and assigns roles to users. There is no role editor:
 * a role is a named bundle of permissions with a data scope, seeded by migration
 * (DEBT-017).
 */
export type RoleRow = { id: number; code: string; name: string; description: string };

export function listRoles(): RoleRow[] {
  return db
    .select({ id: roles.id, code: roles.code, name: roles.name, description: roles.description })
    .from(roles)
    .orderBy(roles.id)
    .all();
}

/** Resolves role codes to ids; an unknown code is a bug in the caller, reported with its name. */
export function roleIdsByCode(codes: string[]): number[] {
  const unique = [...new Set(codes)];
  const rows = unique.length
    ? db.select({ id: roles.id, code: roles.code }).from(roles).where(inArray(roles.code, unique)).all()
    : [];
  const missing = unique.filter((c) => !rows.some((r) => r.code === c));
  if (missing.length > 0) throw new Error(`Role tidak dikenal: ${missing.join(", ")}`);
  return rows.map((r) => r.id);
}

/** A role needs a linked salesman when any of its permissions is scoped to `own` or `team` data. */
export function rolesNeedingSalesman(roleIds: number[]): RoleRow[] {
  if (roleIds.length === 0) return [];
  const needing = new Set(
    db
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(and(inArray(rolePermissions.roleId, roleIds), inArray(rolePermissions.scope, ["own", "team"])))
      .all()
      .map((r) => r.roleId),
  );
  return listRoles().filter((r) => needing.has(r.id));
}

/** Roles of many users at once: `Map<userId, role rows>`. */
export function rolesForUsers(userIds: number[]): Map<number, RoleRow[]> {
  const out = new Map<number, RoleRow[]>();
  if (userIds.length === 0) return out;
  const rows = db
    .select({
      userId: userRoles.userId,
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds))
    .orderBy(roles.id)
    .all();
  for (const { userId, ...role } of rows) out.set(userId, [...(out.get(userId) ?? []), role]);
  return out;
}

/** Names of one user's roles, in role order. */
export const roleNamesOf = (userId: number): string[] =>
  (rolesForUsers([userId]).get(userId) ?? []).map((r) => r.name);

/** Makes `roleIds` exactly the user's roles: adds the missing, removes the rest. */
export function setUserRoles(h: DbHandle, userId: number, roleIds: number[], grantedById: number | null) {
  const current = new Set(
    h.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId)).all().map((r) => r.roleId),
  );
  const wanted = new Set(roleIds);
  for (const roleId of wanted) {
    if (!current.has(roleId)) h.insert(userRoles).values({ userId, roleId, grantedById }).run();
  }
  const removed = [...current].filter((id) => !wanted.has(id));
  if (removed.length > 0) {
    h.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, removed))).run();
  }
}

/** Live, active users who hold `code` through at least one role. */
function holdersOf(code: PermissionCode): number[] {
  return db
    .all<{ id: number }>(
      sql`SELECT DISTINCT u.id
          FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE p.code = ${code} AND u.deleted_at IS NULL AND u.is_active = 1`,
    )
    .map((r) => r.id);
}

/** Whether any of `roleIds` grants `code`. */
function rolesGrant(roleIds: number[], code: PermissionCode): boolean {
  if (roleIds.length === 0) return false;
  return (
    db
      .select({ id: rolePermissions.roleId })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(inArray(rolePermissions.roleId, roleIds), eq(permissions.code, code)))
      .get() !== undefined
  );
}

/**
 * Nobody may lock the application out of its own administration: after a change,
 * at least one live, active user must still be able to manage master data
 * (which includes the user list and their roles).
 */
export function assertAdministrationRemains(opts: {
  userId: number;
  /** The user's roles and status *after* the change; `null` = the user is going away. */
  after: { roleIds: number[]; isActive: boolean } | null;
}) {
  const holders = holdersOf(PERM.masterdataManage);
  if (!holders.includes(opts.userId)) return; // they do not administer today; nothing to protect
  const stillHolds = opts.after !== null && opts.after.isActive && rolesGrant(opts.after.roleIds, PERM.masterdataManage);
  if (stillHolds) return;
  if (holders.length <= 1) {
    throw new Error("Tidak bisa: ini satu-satunya akun yang bisa mengelola data master");
  }
}
