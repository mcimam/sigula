import { Cron } from "croner";
import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { profiles, users } from "~/db/schema";
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

function getFirstAdminUserId(): number | null {
  const row = db
    .select({ id: users.id })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(profiles.role, "admin"))
    .get();
  return row?.id ?? null;
}

/** Run one scheduled notification batch (same rules as manual trigger). */
export async function runScheduledBatch() {
  const cron = getCronSettings();
  if (!cron.enabled) return;

  const adminId = getFirstAdminUserId();
  if (!adminId) {
    recordCronRun("failed", "Tidak ada user admin untuk menjalankan batch");
    return;
  }

  try {
    if (eligibleCustomerCount() === 0) {
      recordCronRun("skipped", "Tidak ada customer eligible");
      return;
    }
    const batch = await triggerBatch({ triggeredById: adminId });
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
    { timezone: "Asia/Jakarta" },
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
