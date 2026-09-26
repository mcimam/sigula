import { Form, redirect, useLoaderData, useNavigation } from "react-router";

import type { Route } from "./+types/admin.dashboard";
import { AppShell, PageHeader, StatusPill, StatTile } from "~/components/AppShell";
import { TablePagination } from "~/components/DataTable";
import type { DeliveryStatus } from "~/db/schema";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { formatStamp } from "~/lib/activity-format";
import { parsePage } from "~/lib/pagination";
import {
  eligibleCustomerCount,
  previewBatch,
  retryBatch,
  runsPage,
  triggerBatch,
  voidBatch,
} from "~/lib/reminders.server";

const NOTHING_TO_SEND = "Tidak ada customer yang perlu diingatkan — tidak ada pengiriman dibuat";

const DELIVERY_STATUS: Record<
  DeliveryStatus,
  { label: string; tone: "ok" | "warn" | "danger" | "muted" }
> = {
  queued: { label: "dalam antrean", tone: "muted" },
  sent: { label: "terkirim", tone: "ok" },
  failed: { label: "gagal", tone: "danger" },
  skipped_no_contact: { label: "dilewati — tanpa nomor WA", tone: "muted" },
};

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.adminDashboard);
  const url = new URL(request.url);

  return {
    user,
    eligible: eligibleCustomerCount(),
    preview: previewBatch(),
    runs: runsPage(parsePage(url.searchParams.get("page"))),
    flash: url.searchParams.get("flash"),
  };
}

/** Back to the dashboard with a message; `page` keeps the history list where the admin was. */
function dashboardFlash(message: string, page = 1) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  params.set("flash", message);
  return redirect(`/admin/dashboard?${params}`);
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requirePermission(request, PERM.notificationManage);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "trigger");
  const page = parsePage(new URL(request.url).searchParams.get("page"));

  try {
    if (intent === "retry") {
      await retryBatch({ batchId: Number(form.get("batch_id")) });
      return dashboardFlash("Pengiriman ulang selesai", page);
    }

    if (intent === "void") {
      const batchId = Number(form.get("batch_id"));
      voidBatch({ batchId, voidedById: user.id, reason: String(form.get("reason") ?? "") });
      return dashboardFlash(`Pengiriman #${batchId} dibatalkan`, page);
    }
  } catch (err) {
    return dashboardFlash(err instanceof Error ? err.message : "Aksi gagal", page);
  }

  if (eligibleCustomerCount() === 0) return dashboardFlash(NOTHING_TO_SEND);

  // A new run is the newest one, so the admin lands on page 1 to see it.
  const batch = await triggerBatch({ triggeredById: user.id });
  return dashboardFlash(batch ? `Pengiriman #${batch.id} selesai — cek status tiap penerima di riwayat` : NOTHING_TO_SEND);
}

export default function AdminDashboard() {
  const { user, eligible, preview, runs, flash } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const intent =
    navigation.formData?.get("intent") != null
      ? String(navigation.formData.get("intent"))
      : null;
  // Retry and cancel post back to the page being viewed, so the list stays put.
  const pageAction = runs.page > 1 ? `/admin/dashboard?page=${runs.page}` : "/admin/dashboard";

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title="Dashboard"
        subtitle="Kirim pengingat WhatsApp ke salesman dan supervisor untuk customer yang sudah overdue dan belum diingatkan."
      />
      <div className="stat-grid">
        <StatTile label="Perlu diingatkan" value={eligible} tone="warn" />
        <StatTile label="Salesman penerima" value={preview.salesmen.length} />
        <StatTile label="Supervisor penerima" value={preview.supervisors.length} />
      </div>

      {eligible === 0 ? (
        <div className="alert alert-warn mb-4">
          Tidak ada customer yang perlu diingatkan saat ini. Customer overdue yang sudah
          diingatkan menunggu alasan dari salesman lewat panel customer.
        </div>
      ) : null}

      {(preview.salesmen.some((s) => !s.salesman.nomorWa) ||
        preview.supervisors.some((s) => !s.supervisor.nomorWa)) && (
        <div className="alert alert-warn mb-4">
          Ada penerima tanpa nomor WA — pesan untuk mereka dilewati.
        </div>
      )}

      <Form method="post" action="/admin/dashboard" className="mb-6">
        <input type="hidden" name="intent" value="trigger" />
        <button
          type="submit"
          className="btn"
          disabled={eligible === 0 || busy}
        >
          {busy && intent === "trigger"
            ? "Mengirim pengingat…"
            : "Kirim pengingat sekarang"}
        </button>
      </Form>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Pratinjau per salesman
      </h2>
      <div className="table-wrap mb-6">
        <table className="data">
          <thead>
            <tr>
              <th>Salesman</th>
              <th>Nomor WA</th>
              <th>Customer yang akan diingatkan</th>
            </tr>
          </thead>
          <tbody>
            {preview.salesmen.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-slate-500">
                  Tidak ada customer yang perlu diingatkan.
                </td>
              </tr>
            ) : (
              preview.salesmen.map(({ salesman, customers }) => (
                <tr key={salesman.id}>
                  <td className="font-medium">{salesman.nama}</td>
                  <td>
                    {salesman.nomorWa || (
                      <StatusPill tone="warn">tanpa nomor WA</StatusPill>
                    )}
                  </td>
                  <td>{customers.map((c) => c.nama).join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Riwayat pengiriman
      </h2>
      <div className="space-y-3">
        {runs.rows.length === 0 ? (
          <div className="card text-slate-500">Belum ada pengiriman.</div>
        ) : null}
        {runs.rows.map((batch) => {
          // Retry a failed message; cancel only what delivered nothing (a sent message stays sent).
          const canRetry = !batch.voidedAt && batch.needsRetry;
          const canCancel = !batch.voidedAt && !batch.deliveries.some((d) => d.status === "sent");
          return (
            <div key={batch.id} className="card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Pengiriman #{batch.id}</span>
                  <span className="text-xs text-slate-400">
                    {batch.trigger === "scheduled" ? "terjadwal" : "manual"}
                  </span>
                  {batch.voidedAt ? (
                    <StatusPill tone="muted">dibatalkan</StatusPill>
                  ) : null}
                </div>
                <div className="text-xs text-slate-500">{formatStamp(batch.startedAt)}</div>
              </div>
              {batch.voidedAt && batch.voidReason ? (
                <p className="mb-2 text-xs text-slate-500">Alasan pembatalan: {batch.voidReason}</p>
              ) : null}
              <ul className="mb-3 space-y-1 text-sm">
                {batch.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {d.name}
                      {d.recipientKind === "supervisor" ? (
                        <span className="text-slate-400"> (supervisor)</span>
                      ) : null}
                    </span>
                    <StatusPill tone={DELIVERY_STATUS[d.status].tone}>
                      {DELIVERY_STATUS[d.status].label}
                    </StatusPill>
                    <span className="text-slate-500">{d.customerCount} customer</span>
                    {d.attempt > 1 ? (
                      <span className="text-xs text-slate-400">percobaan ke-{d.attempt}</span>
                    ) : null}
                    {d.status === "failed" && d.errorMessage ? (
                      <span className="text-xs text-slate-400">{d.errorMessage}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canRetry || canCancel ? (
                <div className="action-row">
                  {canRetry ? (
                    <Form method="post" action={pageAction}>
                      <input type="hidden" name="intent" value="retry" />
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <button
                        type="submit"
                        className="btn btn-sm btn-outline"
                        disabled={busy}
                      >
                        {busy && intent === "retry"
                          ? "Mengirim ulang…"
                          : "Kirim ulang yang gagal"}
                      </button>
                    </Form>
                  ) : null}
                  {canCancel ? (
                    <Form method="post" action={pageAction} className="flex max-w-full flex-wrap items-center gap-2">
                      <input type="hidden" name="intent" value="void" />
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <input
                        name="reason"
                        className="form-control min-w-0 max-w-full"
                        placeholder="Alasan pembatalan (opsional)"
                        aria-label={`Alasan membatalkan pengiriman #${batch.id}`}
                      />
                      <button
                        type="submit"
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={(e) => {
                          if (
                            !confirm(
                              `Batalkan pengiriman #${batch.id}? Pengiriman ini tidak bisa dikirim ulang lagi.`,
                            )
                          ) {
                            e.preventDefault();
                          }
                        }}
                      >
                        {busy && intent === "void" ? "Membatalkan…" : "Batalkan pengiriman"}
                      </button>
                    </Form>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="table-wrap mt-3">
        <TablePagination
          page={runs.page}
          pageSize={runs.pageSize}
          totalPages={runs.totalPages}
          total={runs.total}
          hrefForPage={(p) => `?page=${p}`}
          hiddenFields={{}}
          emptyLabel="0 pengiriman"
        />
      </div>
    </AppShell>
  );
}
