import { eq } from "drizzle-orm";
import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/supervisor.salesmen.$id";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { daysSinceOrder, isOverdue } from "~/lib/dates";
import { subordinateIds } from "~/lib/masterdata.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireRole(request, "supervisor");
  const id = Number(params.id);
  const salesman = db.select().from(salesmen).where(eq(salesmen.id, id)).get();
  if (!salesman || !subordinateIds(user.salesmanId!).includes(salesman.id)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const list = db
    .select()
    .from(customers)
    .where(eq(customers.salesmanId, salesman.id))
    .all()
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
