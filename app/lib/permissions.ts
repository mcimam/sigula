/**
 * The permission vocabulary (ADR-0007). Shared by server guards and the client
 * navigation, so it has no `.server` suffix and no database access. The rows in
 * `permissions` are seeded from this list by migration 0004; a test keeps the two in step.
 */
export const SCOPES = ["own", "team", "all"] as const;
export type Scope = (typeof SCOPES)[number];

/** Wider scope wins when a user holds a permission through several roles. */
const RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };
const widest = (a: Scope, b: Scope): Scope => (RANK[a] >= RANK[b] ? a : b);

export const PERM = {
  adminDashboard: "admin.dashboard",
  notificationManage: "notification.manage",
  transaksiManage: "transaksi.manage",
  masterdataManage: "masterdata.manage",
  auditRead: "audit.read",
  settingsManage: "settings.manage",
  customerFollowUp: "customer.follow_up",
  customerReactivate: "customer.reactivate",
  teamRead: "team.read",
  managementRead: "management.read",
  reportSalesman: "report.salesman",
  reportTeam: "report.team",
  reportManagement: "report.management",
} as const;
export type PermissionCode = (typeof PERM)[keyof typeof PERM];

export type PermissionMap = Partial<Record<PermissionCode, Scope>>;

/** What a signed-in user can do — the part of `AuthUser` the client needs. */
export type Access = { permissions: PermissionMap; salesmanId: number | null };

export const can = (a: Pick<Access, "permissions">, code: PermissionCode): boolean =>
  a.permissions[code] !== undefined;

export const scopeOf = (a: Pick<Access, "permissions">, code: PermissionCode): Scope | null =>
  a.permissions[code] ?? null;

/** Merges grants (one per role) into one map: the widest scope per permission. */
export function mergeGrants(grants: { code: string; scope: Scope }[]): PermissionMap {
  const out: PermissionMap = {};
  for (const g of grants) {
    const code = g.code as PermissionCode;
    out[code] = out[code] ? widest(out[code]!, g.scope) : g.scope;
  }
  return out;
}

/** Where a user lands after signing in: the first area they have access to. */
export function homeFor(a: Pick<Access, "permissions">): string | null {
  if (can(a, PERM.adminDashboard)) return "/admin/dashboard";
  if (can(a, PERM.managementRead)) return "/management";
  if (can(a, PERM.teamRead)) return "/supervisor";
  if (can(a, PERM.customerFollowUp)) return "/salesman";
  return null;
}
