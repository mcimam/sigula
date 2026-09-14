import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationBatches } from "~/db/schema";
import { appSettings } from "~/db/schema";
import { db } from "~/db/client.server";
import { runScheduledBatch, stopCronSchedulerForTests } from "~/lib/cron.server";
import {
  getCronSettings,
  getWahaSettings,
  saveCronSettings,
  saveWahaSettings,
  validateCronExpression,
} from "~/lib/settings.server";

import {
  addCustomer,
  getCustomer,
  resetDb,
  seedOrg,
} from "./helpers/fixtures";

describe("settings.server", () => {
  beforeEach(() => {
    resetDb();
    stopCronSchedulerForTests();
  });

  it("persists WAHA settings with env fallback", () => {
    saveWahaSettings({
      baseUrl: "http://waha.test",
      session: "main",
      apiKey: "secret",
      timeoutMs: 5000,
    });
    expect(getWahaSettings()).toMatchObject({
      baseUrl: "http://waha.test",
      session: "main",
      apiKey: "secret",
      timeoutMs: 5000,
    });
  });

  it("validates cron expressions", () => {
    expect(() => validateCronExpression("0 8 * * *")).not.toThrow();
    expect(() => validateCronExpression("not a cron")).toThrow();
  });

  it("saves cron enabled flag and expression", () => {
    saveCronSettings({ enabled: true, expression: "0 9 * * 1-5" });
    expect(getCronSettings()).toMatchObject({
      enabled: true,
      expression: "0 9 * * 1-5",
    });
  });
});

describe("runScheduledBatch", () => {
  beforeEach(() => {
    resetDb();
    stopCronSchedulerForTests();
    saveCronSettings({ enabled: true, expression: "0 8 * * *" });
  });

  it("skips when nobody is eligible", async () => {
    await seedOrg();
    await runScheduledBatch();
    expect(getCronSettings().lastRunStatus).toBe("skipped");
  });

  it("creates a batch when eligible customers exist", async () => {
    const { salesman } = await seedOrg();
    const c = addCustomer({
      salesmanId: salesman.id,
      nama: "Toko",
      lastOrderDate: "2026-07-01",
    });
    saveWahaSettings({
      baseUrl: "http://waha.test",
      session: "default",
      timeoutMs: 8000,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    await runScheduledBatch();
    expect(getCronSettings().lastRunStatus).toBe("ok");
    expect(getCronSettings().lastRunMessage).toMatch(/Batch #\d+/);
    expect(db.select().from(notificationBatches).all()).toHaveLength(1);
    expect(getCustomer(c.id).notified).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("settings table", () => {
  beforeEach(() => resetDb());

  it("upserts keys instead of duplicating", () => {
    saveWahaSettings({
      baseUrl: "http://a",
      session: "default",
      timeoutMs: 8000,
    });
    saveWahaSettings({
      baseUrl: "http://b",
      session: "default",
      timeoutMs: 8000,
    });
    const rows = db.select().from(appSettings).all();
    expect(rows.filter((r) => r.key === "waha.base_url")).toHaveLength(1);
    expect(getWahaSettings().baseUrl).toBe("http://b");
  });
});
