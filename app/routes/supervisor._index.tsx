import { Link, useLoaderData } from "react-router";

import type { Route } from "./+types/supervisor._index";
import { AppShell, PageHeader, StatTile } from "~/components/AppShell";
import { requireRole } from "~/lib/auth.server";
import { salesmenWithStats } from "~/lib/masterdata.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "supervisor");
  const team = salesmenWithStats(user.salesmanId!);
  return {
    user,
    team,
    totals: {
      salesmanCount: team.length,
      followUp: team.reduce((n, s) => n + s.followUp, 0),
      pending: team.reduce((n, s) => n + s.pending, 0),
    },
  };
}

export default function SupervisorDashboard() {
  const { user, team, totals } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <PageHeader
        title="Dashboard Supervisor"
        subtitle="Ringkasan tim sales Anda"
        actions={
          <Link className="btn btn-outline btn-sm" to="/reports/supervisor/me">
            Export Excel
          </Link>
        }
      />
      <div className="stat-grid">
        <StatTile label="Salesman" value={totals.salesmanCount} />
        <StatTile label="Perlu follow-up" value={totals.followUp} tone="danger" />
        <StatTile label="Pending reminder" value={totals.pending} tone="warn" />
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Salesman</th>
              <th>Aktif</th>
              <th>Inactive</th>
              <th>Follow-up</th>
              <th>Pending</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {team.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.nama}</td>
                <td>{s.aktif}</td>
                <td>{s.inactive}</td>
                <td>{s.followUp}</td>
                <td>{s.pending}</td>
                <td>
                  <Link className="btn btn-outline btn-sm" to={`/supervisor/salesmen/${s.id}`}>
                    Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
