import { eq } from "drizzle-orm";
import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/salesman._index";
import { AppShell, PageHeader, StatusPill, StatTile } from "~/components/AppShell";
import { db } from "~/db/client.server";
import { customers, REASON_LABELS } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { daysSinceOrder, isOverdue } from "~/lib/dates";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "salesman");
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const all = db
    .select()
    .from(customers)
    .where(eq(customers.salesmanId, user.salesmanId!))
    .all();

  const pending = all
    .filter((c) => c.notified)
    .filter((c) => !q || c.nama.toLowerCase().includes(q))
    .map((c) => ({
      ...c,
      days: daysSinceOrder(c.lastOrderDate),
      overdue: isOverdue(c.lastOrderDate, c.orderCycleDays),
    }))
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));

  const followUp = all.filter(
    (c) =>
      c.statusCustomer === "aktif" &&
      isOverdue(c.lastOrderDate, c.orderCycleDays),
  ).length;

  return {
    user,
    pending,
    stats: {
      total: all.length,
      pending: pending.length,
      followUp,
    },
    q,
  };
}

export default function SalesmanDashboard() {
  const { user, pending, stats, q } = useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <PageHeader
        title="Dashboard Salesman"
        subtitle="Customer yang menunggu balasan reminder"
        actions={
          <Link className="btn btn-outline btn-sm" to="/reports/salesman/me">
            Export Excel
          </Link>
        }
      />
      <div className="stat-grid">
        <StatTile label="Total customer" value={stats.total} />
        <StatTile label="Pending reminder" value={stats.pending} tone="warn" />
        <StatTile label="Perlu follow-up" value={stats.followUp} tone="danger" />
      </div>

      <Form method="get" className="mb-4">
        <input
          className="form-control"
          name="q"
          defaultValue={q}
          placeholder="Cari nama customer…"
          aria-label="Cari customer"
        />
      </Form>

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
            {pending.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  Tidak ada customer pending.
                </td>
              </tr>
            ) : (
              pending.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.nama}</td>
                  <td>{c.days ?? "belum pernah"}</td>
                  <td>{c.orderCycleDays}h</td>
                  <td>
                    <StatusPill tone={c.overdue ? "danger" : "ok"}>
                      {c.overdue ? "Overdue" : "OK"}
                    </StatusPill>
                  </td>
                  <td>
                    <div className="action-row">
                      {(["1", "2", "3"] as const).map((code) => (
                        <Form
                          key={code}
                          method="post"
                          action={`/salesman/customers/${c.id}/reason`}
                        >
                          <input type="hidden" name="kode_alasan" value={code} />
                          <button
                            type="submit"
                            className={`btn btn-sm ${code === "3" ? "btn-danger" : "btn-outline"}`}
                          >
                            {REASON_LABELS[code]}
                          </button>
                        </Form>
                      ))}
                      <Form
                        method="post"
                        action={`/salesman/customers/${c.id}/record-order`}
                      >
                        <button type="submit" className="btn btn-sm">
                          Catat Order
                        </button>
                      </Form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
