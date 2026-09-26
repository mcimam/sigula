import { Cron } from "croner";
import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { appSettings } from "~/db/schema";
import { BUSINESS_TIMEZONE, nowIso } from "~/lib/dates";

export type WahaSettings = {
  baseUrl: string;
  session: string;
  apiKey: string;
  timeoutMs: number;
  /** The HMAC key WAHA signs its webhook calls with (ADR-0009); "" = replies are not accepted. */
  webhookSecret: string;
};

export type CronSettings = {
  enabled: boolean;
  expression: string;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "skipped" | "failed" | null;
  lastRunMessage: string;
};

export type CronPreset = {
  id: string;
  label: string;
  expression: string;
};

export const CRON_PRESETS: CronPreset[] = [
  { id: "daily-08", label: "Setiap hari 08:00", expression: "0 8 * * *" },
  { id: "daily-09", label: "Setiap hari 09:00", expression: "0 9 * * *" },
  { id: "weekday-08", label: "Sen–Jum 08:00", expression: "0 8 * * 1-5" },
  { id: "mon-08", label: "Setiap Senin 08:00", expression: "0 8 * * 1" },
];

const KEYS = {
  wahaBaseUrl: "waha.base_url",
  wahaSession: "waha.session",
  wahaApiKey: "waha.api_key",
  wahaTimeoutMs: "waha.timeout_ms",
  wahaWebhookSecret: "waha.webhook_secret",
  cronEnabled: "cron.enabled",
  cronExpression: "cron.expression",
  cronLastRunAt: "cron.last_run_at",
  cronLastRunStatus: "cron.last_run_status",
  cronLastRunMessage: "cron.last_run_message",
} as const;

function readSetting(key: string): string | null {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? null;
}

/** Values that must never be shown or logged whole. */
const SECRET_KEYS: ReadonlySet<string> = new Set([KEYS.wahaApiKey, KEYS.wahaWebhookSecret]);

function writeSetting(key: string, value: string, updatedById: number | null = null) {
  const audit = { updatedAt: nowIso(), updatedById };
  db.insert(appSettings)
    .values({ key, value, isSecret: SECRET_KEYS.has(key), ...audit })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, ...audit },
    })
    .run();
}

export function getWahaSettings(): WahaSettings {
  const baseUrl =
    readSetting(KEYS.wahaBaseUrl) ?? process.env.WAHA_BASE_URL ?? "";
  const session =
    readSetting(KEYS.wahaSession) ?? process.env.WAHA_SESSION ?? "default";
  const apiKey =
    readSetting(KEYS.wahaApiKey) ?? process.env.WAHA_API_KEY ?? "";
  const timeoutRaw =
    readSetting(KEYS.wahaTimeoutMs) ?? process.env.WAHA_TIMEOUT_MS ?? "8000";
  const timeoutMs = Number(timeoutRaw) || 8000;
  const webhookSecret =
    readSetting(KEYS.wahaWebhookSecret) ?? process.env.WAHA_WEBHOOK_SECRET ?? "";
  return {
    baseUrl: baseUrl.trim(),
    session: session.trim() || "default",
    apiKey,
    timeoutMs: Math.min(Math.max(timeoutMs, 1000), 60_000),
    webhookSecret,
  };
}

export function saveWahaSettings(
  input: {
    baseUrl: string;
    session: string;
    apiKey?: string;
    /** Blank = keep the stored one, like the API key. */
    webhookSecret?: string;
    timeoutMs: number;
  },
  updatedById: number | null = null,
) {
  writeSetting(KEYS.wahaBaseUrl, input.baseUrl.trim(), updatedById);
  writeSetting(KEYS.wahaSession, input.session.trim() || "default", updatedById);
  if (input.apiKey !== undefined && input.apiKey.length > 0) {
    writeSetting(KEYS.wahaApiKey, input.apiKey, updatedById);
  }
  if (input.webhookSecret !== undefined && input.webhookSecret.length > 0) {
    writeSetting(KEYS.wahaWebhookSecret, input.webhookSecret.trim(), updatedById);
  }
  writeSetting(
    KEYS.wahaTimeoutMs,
    String(Math.min(Math.max(input.timeoutMs, 1000), 60_000)),
    updatedById,
  );
}

export function hasStoredWahaApiKey() {
  return Boolean(readSetting(KEYS.wahaApiKey)?.length);
}

export function hasWebhookSecret() {
  return getWahaSettings().webhookSecret.length > 0;
}

export function getCronSettings(): CronSettings {
  const enabledRaw = readSetting(KEYS.cronEnabled);
  const enabled = enabledRaw === "1" || enabledRaw === "true";
  const expression =
    readSetting(KEYS.cronExpression) ?? CRON_PRESETS[0].expression;
  const lastRunStatusRaw = readSetting(KEYS.cronLastRunStatus);
  const lastRunStatus =
    lastRunStatusRaw === "ok" ||
    lastRunStatusRaw === "skipped" ||
    lastRunStatusRaw === "failed"
      ? lastRunStatusRaw
      : null;
  return {
    enabled,
    expression: expression.trim() || CRON_PRESETS[0].expression,
    lastRunAt: readSetting(KEYS.cronLastRunAt),
    lastRunStatus,
    lastRunMessage: readSetting(KEYS.cronLastRunMessage) ?? "",
  };
}

export function saveCronSettings(
  input: {
    enabled: boolean;
    expression: string;
  },
  updatedById: number | null = null,
) {
  const expression = input.expression.trim();
  if (!expression) {
    throw new Error("Ekspresi cron wajib diisi");
  }
  validateCronExpression(expression);
  writeSetting(KEYS.cronEnabled, input.enabled ? "1" : "0", updatedById);
  writeSetting(KEYS.cronExpression, expression, updatedById);
}

export function recordCronRun(
  status: "ok" | "skipped" | "failed",
  message: string,
) {
  writeSetting(KEYS.cronLastRunAt, new Date().toISOString());
  writeSetting(KEYS.cronLastRunStatus, status);
  writeSetting(KEYS.cronLastRunMessage, message);
}

/** Validate a cron expression (throws on invalid). */
export function validateCronExpression(expression: string) {
  const job = new Cron(expression, { paused: true, timezone: BUSINESS_TIMEZONE });
  job.stop();
}

export function cronPresetForExpression(expression: string) {
  const match = CRON_PRESETS.find((p) => p.expression === expression.trim());
  return match?.id ?? "custom";
}
