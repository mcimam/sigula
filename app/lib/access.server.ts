import { subordinateIds } from "~/lib/masterdata.server";
import { scopeOf, type PermissionCode } from "~/lib/permissions";
import type { AuthUser } from "~/lib/auth.server";

/**
 * Row-level checks that go with a permission's scope (ADR-0007). A route first
 * requires the permission (`requirePermission`), then asks here whether *this*
 * salesman's data is within the user's reach. Each throws a 403 `Response`.
 */
const forbidden = () => new Response("Forbidden", { status: 403 });

/**
 * The salesman a page acts as. A role whose permissions are `own`/`team` scoped
 * needs one (the user form enforces it); a user without it gets a 403 instead of
 * a query with no salesman, which would read as "everyone". DEBT-018: the database
 * does not guarantee the link, this is the safety net.
 */
export function requireSalesmanId(user: AuthUser): number {
  if (user.salesmanId == null) throw forbidden();
  return user.salesmanId;
}

/**
 * `all` reaches any salesman; anything narrower reaches only the user's own
 * salesman. (The salesman dashboard, reminder export and team export all work
 * this way: "my own team" is the salesman I lead.)
 */
export function canOwnOrAll(user: AuthUser, code: PermissionCode, salesmanId: number): boolean {
  const scope = scopeOf(user, code);
  if (scope === "all") return true;
  return scope !== null && user.salesmanId != null && user.salesmanId === salesmanId;
}

export function assertOwnOrAll(user: AuthUser, code: PermissionCode, salesmanId: number) {
  if (!canOwnOrAll(user, code, salesmanId)) throw forbidden();
}

/**
 * `all` reaches any salesman; `team` reaches only the user's subordinates (at any
 * depth, not the user); `own` reaches nothing here.
 */
export function assertInTeamOrAll(user: AuthUser, code: PermissionCode, salesmanId: number) {
  const scope = scopeOf(user, code);
  if (scope === "all") return;
  if (scope === "team" && user.salesmanId != null && subordinateIds(user.salesmanId).includes(salesmanId)) {
    return;
  }
  throw forbidden();
}
