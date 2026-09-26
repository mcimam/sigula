import { desc, eq } from "drizzle-orm";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";

import type { Route } from "./+types/admin.dashboard";
import { AppShell, PageHeader, StatusPill, StatTile } from "~/components/AppShell";
import { db } from "~/db/client.server";
import {
  notificationBatches,
  notificationDeliveries,
  salesmen,
} from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import {
  eligibleCustomerCount,
  previewBatch,
  retryBatch,
  triggerBatch,
  deleteBatch,
} from "~/lib/reminders.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const preview = previewBatch();
  const recent = db
    .select()
    .from(notificationBatches)
    .orderBy(desc(notificationBatches.id))
    .limit(5)
    .all()
    .map((batch) => {
      const deliveries = db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.batchId, batch.id))
        .all()
        .map((d) => {
          const name = db
            .select()
            .from(salesmen)
            .where(eq(salesmen.id, d.salesmanId))
            .get()?.nama;
          return { ...d, name: name ?? "?" };
        });
      return { ...batch, deliveries };
    });

  return {
    user,
    eligible: eligibleCustomerCount(),
    preview,
    recent,
    flash: new URL(request.url).searchParams.get("flash"),
  };
}

function dashboardFlash(message: string) {
  return redirect(`/admin/dashboard?flash=${encodeURIComponent(message)}`);
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireRole(request, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "trigger");

  if (intent === "retry") {
    const batchId = Number(form.get("batch_id"));
    await retryBatch({ batchId });
    return dashboardFlash("Retry selesai");
  }

  if (intent === "delete") {
    const batchId = Number(form.get("batch_id"));
    deleteBatch(batchId);
    return dashboardFlash(
      `Batch #${batchId} dihapus — flag notified direset untuk salesman terkait`,
    );
  }

  if (eligibleCustomerCount() === 0) {
    return dashboardFlash(
      "Tidak ada customer eligible — batch tidak dibuat",
    );
  }

  const batch = await triggerBatch({ triggeredById: user.id });
  const msg = batch
    ? `Batch #${batch.id} dikirim`
    : "Tidak ada customer eligible — batch tidak dibuat";
  return dashboardFlash(msg);
}

export default function AdminDashboard() {
  const { user, eligible, preview, recent, flash } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const intent =
    navigation.formData?.get("intent") != null
      ? String(navigation.formData.get("intent"))
      : null;

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title="Dashboard"
        subtitle="Trigger manual — hanya customer eligible yang belum notified"
      />
      <div className="stat-grid">
        <StatTile label="Eligible sekarang" value={eligible} tone="warn" />
        <StatTile label="Salesman terdampak" value={preview.salesmen.length} />
        <StatTile label="Supervisor terdampak" value={preview.supervisors.length} />
      </div>

      {eligible === 0 ? (
        <div className="alert alert-warn mb-4">
          Tidak ada customer eligible. Tombol kirim nonaktif sampai ada customer
          overdue yang belum notified — hapus batch terbaru untuk mereset flag
          notified, atau isi alasan follow-up di sisi salesman.
        </div>
      ) : null}

      {(preview.salesmen.some((s) => !s.salesman.nomorWa) ||
        preview.supervisors.some((s) => !s.supervisor.nomorWa)) && (
        <div className="alert alert-warn mb-4">
          Ada penerima tanpa nomor WA — pengiriman akan di-skip untuk mereka (FR-17).
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
            ? "Mengirim batch…"
            : "Kirim batch sekarang"}
        </button>
      </Form>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Preview per salesman
      </h2>
      <div className="table-wrap mb-6">
        <table className="data">
          <thead>
            <tr>
              <th>Salesman</th>
              <th>WA</th>
              <th>Customer</th>
            </tr>
          </thead>
          <tbody>
            {preview.salesmen.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-slate-500">
                  Tidak ada yang eligible.
                </td>
              </tr>
            ) : (
              preview.salesmen.map(({ salesman, customers }) => (
                <tr key={salesman.id}>
                  <td className="font-medium">{salesman.nama}</td>
                  <td>
                    {salesman.nomorWa || (
                      <StatusPill tone="warn">tanpa WA</StatusPill>
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
        Batch terbaru
      </h2>
      <div className="space-y-3">
        {recent.map((batch) => (
          <div key={batch.id} className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">Batch #{batch.id}</div>
              <div className="text-xs text-slate-500">{batch.tanggal}</div>
            </div>
            <ul className="mb-3 space-y-1 text-sm">
              {batch.deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {d.name}
                    {d.recipientKind === "supervisor" ? (
                      <span className="text-slate-400"> (supervisor)</span>
                    ) : null}
                  </span>
                  <StatusPill
                    tone={
                      d.status === "sent"
                        ? "ok"
                        : d.status === "failed"
                          ? "danger"
                          : "muted"
                    }
                  >
                    {d.status}
                  </StatusPill>
                  <span className="text-slate-500">{d.customerCount} customer</span>
                </li>
              ))}
            </ul>
            <div className="action-row">
              {batch.deliveries.some((d) => d.status === "failed") ? (
                <Form method="post" action="/admin/dashboard">
                  <input type="hidden" name="intent" value="retry" />
                  <input type="hidden" name="batch_id" value={batch.id} />
                  <button
                    type="submit"
                    className="btn btn-sm btn-outline"
                    disabled={busy}
                  >
                    {busy && intent === "retry"
                      ? "Retry…"
                      : "Retry yang gagal"}
                  </button>
                </Form>
              ) : null}
              <Form method="post" action="/admin/dashboard">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="batch_id" value={batch.id} />
                <button
                  type="submit"
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={(e) => {
                    if (
                      !confirm(
                        `Hapus batch #${batch.id}? Flag notified salesman terkait akan direset.`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  {busy && intent === "delete" ? "Menghapus…" : "Hapus batch"}
                </button>
              </Form>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
