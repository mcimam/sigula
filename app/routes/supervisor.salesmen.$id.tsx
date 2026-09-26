import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/supervisor.salesmen.$id";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { assertInTeamOrAll } from "~/lib/access.server";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { daysSinceOrder, isOverdue } from "~/lib/dates";
import { findLiveSalesman, liveCustomersOf } from "~/lib/masterdata.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.teamRead);
  const id = Number(params.id);
  const salesman = findLiveSalesman(id);
  if (!salesman) throw new Response("Forbidden", { status: 403 });
  assertInTeamOrAll(user, PERM.teamRead, salesman.id);
  const list = liveCustomersOf(salesman.id)
    .map((c) => ({
      ...c,
      days: daysSinceOrder(c.lastOrderDate),
      overdue: isOverdue(c.lastOrderDate, c.orderCycleDays),
    }))
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));

  return { user, salesman, list };
}

export default function SupervisorSalesmanDetail() {
  const { user, salesman, list } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <PageHeader
        title={salesman.nama}
        subtitle="Daftar customer, diurutkan paling overdue"
        actions={
          <Link className="btn btn-outline btn-sm" to="/supervisor">
            ← Kembali
          </Link>
        }
      />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Hari</th>
              <th>Siklus</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.nama}</td>
                <td>{c.days ?? "belum pernah"}</td>
                <td>{c.orderCycleDays}h</td>
                <td>
                  <StatusPill
                    tone={
                      c.statusCustomer === "inactive"
                        ? "muted"
                        : c.overdue
                          ? "danger"
                          : "ok"
                    }
                  >
                    {c.statusCustomer === "inactive"
                      ? "Inactive"
                      : c.overdue
                        ? "Overdue"
                        : "Aktif"}
                  </StatusPill>
                </td>
                <td>
                  {c.statusCustomer === "inactive" ? (
                    <Form
                      method="post"
                      action={`/supervisor/customers/${c.id}/reactivate`}
                    >
                      <button type="submit" className="btn btn-sm btn-outline">
                        Reaktivasi
                      </button>
                    </Form>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
