import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import type { Route } from "./+types/admin.settings";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { WahaSessionCard } from "~/components/WahaSessionCard";
import { refreshCronScheduler } from "~/lib/cron.server";
import { requireRole } from "~/lib/auth.server";
import {
  CRON_PRESETS,
  cronPresetForExpression,
  getCronSettings,
  getWahaSettings,
  hasStoredWahaApiKey,
  saveCronSettings,
  saveWahaSettings,
} from "~/lib/settings.server";
import { testWahaConnection } from "~/lib/waha.server";

const TAB_HEADER = {
  waha: {
    label: "Koneksi WAHA",
    subtitle: "Koneksi dan sesi WhatsApp lewat WAHA",
  },
  cron: {
    label: "Jadwal Cron",
    subtitle: "Jadwal pengiriman batch otomatis",
  },
} as const;

function settingsRedirect(message: string, tab?: string) {
  const params = new URLSearchParams({ flash: message });
  if (tab) params.set("tab", tab);
  return redirect(`/admin/settings?${params.toString()}`);
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const url = new URL(request.url);
  const tab: keyof typeof TAB_HEADER =
    url.searchParams.get("tab") === "cron" ? "cron" : "waha";
  const waha = getWahaSettings();
  const cron = getCronSettings();
  return {
    user,
    tab,
    flash: url.searchParams.get("flash"),
    waha: {
      baseUrl: waha.baseUrl,
      session: waha.session,
      timeoutMs: waha.timeoutMs,
      hasApiKey: hasStoredWahaApiKey() || Boolean(process.env.WAHA_API_KEY),
    },
    cron: {
      ...cron,
      preset: cronPresetForExpression(cron.expression),
    },
    presets: CRON_PRESETS,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireRole(request, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save_waha") {
    const baseUrl = String(form.get("base_url") ?? "").trim();
    const session = String(form.get("session") ?? "default").trim();
    const apiKeyRaw = String(form.get("api_key") ?? "");
    const timeoutMs = Number(form.get("timeout_ms") ?? 8000);
    saveWahaSettings({
      baseUrl,
      session,
      apiKey: apiKeyRaw.length > 0 ? apiKeyRaw : undefined,
      timeoutMs,
    });
    return settingsRedirect("Pengaturan WAHA disimpan", "waha");
  }

  if (intent === "test_waha") {
    const baseUrl = String(form.get("base_url") ?? "").trim();
    const session = String(form.get("session") ?? "default").trim();
    const apiKeyRaw = String(form.get("api_key") ?? "");
    const timeoutMs = Number(form.get("timeout_ms") ?? 8000);
    const saved = getWahaSettings();
    const result = await testWahaConnection({
      baseUrl: baseUrl || saved.baseUrl,
      session: session || saved.session,
      apiKey: apiKeyRaw.length > 0 ? apiKeyRaw : saved.apiKey,
      timeoutMs,
    });
    return {
      tab: "waha" as const,
      testResult: result,
    };
  }

  if (intent === "save_cron") {
    const enabled = form.get("enabled") === "on";
    const preset = String(form.get("preset") ?? "daily-08");
    const customExpression = String(form.get("custom_expression") ?? "").trim();
    const presetRow = CRON_PRESETS.find((p) => p.id === preset);
    const expression =
      preset === "custom"
        ? customExpression
        : (presetRow?.expression ?? CRON_PRESETS[0].expression);
    try {
      saveCronSettings({ enabled, expression });
      refreshCronScheduler();
      return settingsRedirect(
        enabled
          ? `Jadwal cron aktif (${expression}, Asia/Jakarta)`
          : "Jadwal cron dinonaktifkan",
        "cron",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { tab: "cron" as const, error: message };
    }
  }

  return { tab: "waha" as const, error: "Aksi tidak dikenali" };
}

export default function AdminSettings() {
  const { user, tab, flash, waha, cron, presets } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const activeTab = actionData?.tab ?? tab;
  const error = actionData && "error" in actionData ? actionData.error : null;
  const testResult =
    actionData && "testResult" in actionData ? actionData.testResult : null;

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title={`Pengaturan · ${TAB_HEADER[activeTab].label}`}
        subtitle={TAB_HEADER[activeTab].subtitle}
      />

      {error ? (
        <div className="alert alert-danger mb-4" role="alert">
          {error}
        </div>
      ) : null}

      {activeTab === "waha" ? (
        <div className="card max-w-2xl">
          <p className="mb-4 text-sm text-slate-500">
            Nilai di sini disimpan di database aplikasi dan dipakai untuk semua
            pengiriman WhatsApp. Environment variable tetap menjadi fallback
            jika kolom kosong.
          </p>

          {testResult ? (
            <div
              className={`alert mb-4 ${testResult.ok ? "alert-ok" : "alert-danger"}`}
              role="status"
            >
              {testResult.ok
                ? "Koneksi WAHA berhasil."
                : `Gagal: ${testResult.errorMessage}`}
            </div>
          ) : null}

          <Form method="post" action="/admin/settings">
            <div className="form-field">
              <label htmlFor="base_url">Base URL</label>
              <input
                id="base_url"
                name="base_url"
                className="form-control"
                placeholder="http://127.0.0.1:3000"
                defaultValue={waha.baseUrl}
              />
            </div>
            <div className="form-field">
              <label htmlFor="session">Session</label>
              <input
                id="session"
                name="session"
                className="form-control"
                defaultValue={waha.session || "default"}
              />
            </div>
            <div className="form-field">
              <label htmlFor="api_key">API Key</label>
              <input
                id="api_key"
                name="api_key"
                type="password"
                className="form-control"
                placeholder={
                  waha.hasApiKey ? "•••••••• (kosongkan jika tidak berubah)" : ""
                }
                autoComplete="off"
              />
            </div>
            <div className="form-field">
              <label htmlFor="timeout_ms">Timeout (ms)</label>
              <input
                id="timeout_ms"
                name="timeout_ms"
                type="number"
                min={1000}
                max={60000}
                className="form-control"
                defaultValue={waha.timeoutMs}
              />
            </div>
            <div className="action-row">
              <button
                type="submit"
                name="intent"
                value="save_waha"
                className="btn"
                disabled={busy}
              >
                Simpan WAHA
              </button>
              <button
                type="submit"
                name="intent"
                value="test_waha"
                className="btn btn-outline"
                disabled={busy}
              >
                Tes koneksi
              </button>
            </div>
          </Form>
        </div>
      ) : (
        <div className="card max-w-2xl">
          {/* DEBT-010: opt-in scheduled batch — contradicts ADR-0002 manual-only default */}
          <div className="alert alert-warn mb-4">
            Pengiriman otomatis meningkatkan risiko nomor WA di-rate-limit.
            Nonaktifkan jika masih pilot manual-only (ADR-0002).
          </div>

          <Form method="post">
            <input type="hidden" name="intent" value="save_cron" />
            <label className="mb-4 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={cron.enabled}
                className="h-4 w-4"
              />
              Aktifkan jadwal otomatis
            </label>

            <div className="form-field">
              <label htmlFor="preset">Preset jadwal</label>
              <select
                id="preset"
                name="preset"
                className="form-control"
                defaultValue={cron.preset}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.expression})
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="custom_expression">Ekspresi cron (custom)</label>
              <input
                id="custom_expression"
                name="custom_expression"
                className="form-control font-mono text-sm"
                placeholder="0 8 * * *"
                defaultValue={
                  cron.preset === "custom" ? cron.expression : ""
                }
              />
              <p className="text-xs text-slate-500">
                Timezone: Asia/Jakarta. Format: menit jam hari bulan hari-minggu.
              </p>
            </div>

            {cron.lastRunAt ? (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="font-medium text-slate-700">Jalankan terakhir</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-slate-600">{cron.lastRunAt}</span>
                  {cron.lastRunStatus ? (
                    <StatusPill
                      tone={
                        cron.lastRunStatus === "ok"
                          ? "ok"
                          : cron.lastRunStatus === "skipped"
                            ? "warn"
                            : "danger"
                      }
                    >
                      {cron.lastRunStatus}
                    </StatusPill>
                  ) : null}
                </div>
                {cron.lastRunMessage ? (
                  <div className="mt-1 text-slate-500">{cron.lastRunMessage}</div>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-sm text-slate-500">
                Belum pernah dijalankan otomatis.
              </p>
            )}

            <button type="submit" className="btn" disabled={busy}>
              Simpan jadwal
            </button>
          </Form>
        </div>
      )}

      {activeTab === "waha" ? <WahaSessionCard /> : null}
    </AppShell>
  );
}
