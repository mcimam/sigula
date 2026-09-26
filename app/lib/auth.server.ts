import bcrypt from "bcrypt";
import { and, eq, isNull, or } from "drizzle-orm";
import { createCookieSessionStorage, redirect } from "react-router";

import { db } from "~/db/client.server";
import { alive, permissions, rolePermissions, roles, salesmen, userRoles, users } from "~/db/schema";
import { nowIso } from "~/lib/dates";
import {
  can,
  mergeGrants,
  type Access,
  type PermissionCode,
  type Scope,
} from "~/lib/permissions";

const SESSION_SECRET = (() => {
  const value = process.env.SESSION_SECRET;
  if (value && value.length > 0 && value !== "dev-only-change-me") return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to a non-default value in production",
    );
  }
  return value && value.length > 0 ? value : "dev-only-change-me";
})();

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__sigula_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12, // 12h — tighter than Django's 2-week default (DEBT-002 closed)
  },
});

export type AuthUser = Access & {
  id: number;
  username: string;
  displayName: string;
  /** Names of the user's roles, for display. What they may do is `permissions`. */
  roleNames: string[];
};

/**
 * Who may hold a session: a live, active user whose linked salesman (if any) is
 * live too. Needs `salesmen` left-joined on `users.salesman_id`.
 */
const canSignIn = () =>
  and(alive(users), eq(users.isActive, true), or(isNull(users.salesmanId), isNull(salesmen.deletedAt)));

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getUserId(request: Request): Promise<number | null> {
  const session = await getSession(request);
  const userId = session.get("userId");
  return typeof userId === "number" ? userId : null;
}

export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const userId = await getUserId(request);
  if (userId == null) return null;

  const row = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      salesmanId: users.salesmanId,
    })
    .from(users)
    .leftJoin(salesmen, eq(salesmen.id, users.salesmanId))
    .where(and(eq(users.id, userId), canSignIn()))
    .get();
  if (!row) return null;

  // One row per (role, permission); a role without permissions still shows up in `roleNames`.
  const grants = db
    .select({
      roleName: roles.name,
      code: permissions.code,
      scope: rolePermissions.scope,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, row.id))
    .all();

  return {
    ...row,
    roleNames: [...new Set(grants.map((g) => g.roleName))].sort(),
    permissions: mergeGrants(
      grants.filter((g): g is typeof g & { code: string; scope: Scope } => g.code !== null && g.scope !== null),
    ),
  };
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getAuthUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return user;
}

/** Signed in *and* holding `code`; otherwise 403 (or a redirect to the login page). */
export async function requirePermission(
  request: Request,
  code: PermissionCode,
): Promise<AuthUser> {
  const user = await requireUser(request);
  if (!can(user, code)) throw new Response("Forbidden", { status: 403 });
  return user;
}

export async function createUserSession(
  userId: number,
  redirectTo: string,
) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return redirect(redirectTo, {
    status: 303,
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session),
    },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    status: 303,
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginThrottle(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

export async function verifyLogin(username: string, password: string) {
  const user = db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .leftJoin(salesmen, eq(salesmen.id, users.salesmanId))
    .where(and(eq(users.username, username), canSignIn()))
    .get();
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

/** Records a successful sign-in (shown in the user list). */
export function recordLogin(userId: number) {
  db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, userId)).run();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}
