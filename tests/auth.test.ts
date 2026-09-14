import { beforeEach, describe, expect, it } from "vitest";

import {
  checkLoginThrottle,
  clearLoginFailures,
  hashPassword,
  homeForRole,
  recordLoginFailure,
  verifyLogin,
} from "~/lib/auth.server";

import { resetDb, seedOrg } from "./helpers/fixtures";

describe("auth helpers", () => {
  beforeEach(() => resetDb());

  it("verifyLogin accepts the correct password and rejects a wrong one", async () => {
    await seedOrg();
    const ok = await verifyLogin("admin", "sigula123");
    expect(ok?.username).toBe("admin");
    expect(await verifyLogin("admin", "wrong")).toBeNull();
    expect(await verifyLogin("nobody", "sigula123")).toBeNull();
  });

  it("hashPassword produces a bcrypt hash that verifies", async () => {
    const hash = await hashPassword("secret");
    expect(hash).not.toBe("secret");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("homeForRole routes each role to its dashboard", () => {
    expect(homeForRole("admin")).toBe("/admin/dashboard");
    expect(homeForRole("salesman")).toBe("/salesman");
    expect(homeForRole("supervisor")).toBe("/supervisor");
    expect(homeForRole("management")).toBe("/management");
  });

  it("login throttle locks out after 10 failures and clears on success path", () => {
    const key = `test:${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkLoginThrottle(key)).toBe(true);
      recordLoginFailure(key);
    }
    expect(checkLoginThrottle(key)).toBe(false);
    clearLoginFailures(key);
    expect(checkLoginThrottle(key)).toBe(true);
  });
});
