import { Cron } from "croner";

import { BUSINESS_TIMEZONE } from "~/lib/dates";
import { eligibleCustomerCount, triggerBatch } from "~/lib/reminders.server";
import {
  getCronSettings,
  recordCronRun,
  validateCronExpression,
} from "~/lib/settings.server";

type CronGlobal = typeof globalThis & {
  __sigulaCron?: Cron;
};

const g = globalThis as CronGlobal;

/** Run one scheduled notification batch (same rules as manual trigger). */
export async function runScheduledBatch() {
  const cron = getCronSettings();
  if (!cron.enabled) return;

  try {
    if (eligibleCustomerCount() === 0) {
      recordCronRun("skipped", "Tidak ada customer eligible");
      return;
    }
    const batch = await triggerBatch({ triggeredById: null });
    if (!batch) {
      recordCronRun("skipped", "Tidak ada customer eligible");
      return;
    }
    recordCronRun("ok", `Batch #${batch.id} dikirim otomatis`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordCronRun("failed", reason);
  }
}

/** (Re)start the in-process cron job from saved settings. */
export function refreshCronScheduler() {
  if (g.__sigulaCron) {
    g.__sigulaCron.stop();
    g.__sigulaCron = undefined;
  }

  const cron = getCronSettings();
  if (!cron.enabled) return;

  try {
    validateCronExpression(cron.expression);
  } catch {
    console.error("[sigula cron] invalid expression:", cron.expression);
    return;
  }

  g.__sigulaCron = new Cron(
    cron.expression,
    { timezone: BUSINESS_TIMEZONE },
    () => {
      void runScheduledBatch();
    },
  );
}

/** Idempotent — call once per server process (e.g. root loader). */
export function ensureCronScheduler() {
  if (g.__sigulaCron) return;
  refreshCronScheduler();
}

/** Test helper — stop any running job. */
export function stopCronSchedulerForTests() {
  if (g.__sigulaCron) {
    g.__sigulaCron.stop();
    g.__sigulaCron = undefined;
  }
}
