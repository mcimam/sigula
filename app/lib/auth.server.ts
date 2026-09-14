import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { createCookieSessionStorage, redirect } from "react-router";

import { db } from "~/db/client.server";
import { profiles, users, type Role } from "~/db/schema";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-change-me";

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

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  salesmanId: number | null;
  supervisorId: number | null;
};

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
      role: profiles.role,
      salesmanId: profiles.salesmanId,
      supervisorId: profiles.supervisorId,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .get();

  return row ?? null;
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getAuthUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return user;
}

export async function requireRole(
  request: Request,
  roles: Role | Role[],
): Promise<AuthUser> {
  const user = await requireUser(request);
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
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
  const user = db.select().from(users).where(eq(users.username, username)).get();
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function homeForRole(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin/dashboard";
    case "salesman":
      return "/salesman";
    case "supervisor":
      return "/supervisor";
    case "management":
      return "/management";
  }
}
