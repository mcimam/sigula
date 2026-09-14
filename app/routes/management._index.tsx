import { useLoaderData, Link } from "react-router";

import type { Route } from "./+types/management._index";
import { AppShell, PageHeader, StatTile } from "~/components/AppShell";
import { db } from "~/db/client.server";
import { reasonLogs, REASON_LABELS } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { supervisorsWithStats } from "~/lib/masterdata.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "management");
  const supers = supervisorsWithStats();
  const reasons = db.select().from(reasonLogs).all();
  const reasonCounts = (["1", "2", "3"] as const).map((code) => ({
    code,
    label: REASON_LABELS[code],
    count: reasons.filter((r) => r.kodeAlasan === code).length,
  }));
  return {
    user,
    supers,
    reasonCounts,
    totals: {
      followUp: supers.reduce((n, s) => n + s.followUp, 0),
      pending: supers.reduce((n, s) => n + s.pending, 0),
    },
  };
}

export default function ManagementDashboard() {
  const { user, supers, reasonCounts, totals } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <PageHeader
        title="Dashboard Manajemen"
        subtitle="Ringkasan lintas supervisor"
        actions={
          <Link className="btn btn-outline btn-sm" to="/reports/management">
            Export Excel
          </Link>
        }
      />
      <div className="stat-grid">
        <StatTile label="Supervisor" value={supers.length} />
        <StatTile label="Perlu follow-up" value={totals.followUp} tone="danger" />
        <StatTile label="Pending reminder" value={totals.pending} tone="warn" />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Per supervisor
      </h2>
      <div className="table-wrap mb-6">
        <table className="data">
          <thead>
            <tr>
              <th>Supervisor</th>
              <th>Salesman</th>
              <th>Aktif</th>
              <th>Follow-up</th>
              <th>Pending</th>
            </tr>
          </thead>
          <tbody>
            {supers.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.nama}</td>
                <td>{s.salesmanCount}</td>
                <td>{s.aktif}</td>
                <td>{s.followUp}</td>
                <td>{s.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Breakdown alasan
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Label</th>
              <th>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {reasonCounts.map((r) => (
              <tr key={r.code}>
                <td>{r.code}</td>
                <td>{r.label}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
