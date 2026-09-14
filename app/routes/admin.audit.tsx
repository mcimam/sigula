import { desc, eq } from "drizzle-orm";
import { useLoaderData } from "react-router";

import type { Route } from "./+types/admin.audit";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { db } from "~/db/client.server";
import {
  customers,
  mutationLogs,
  salesmen,
  statusLogs,
  users,
} from "~/db/schema";
import { requireRole } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const mutations = db
    .select()
    .from(mutationLogs)
    .orderBy(desc(mutationLogs.id))
    .limit(50)
    .all()
    .map((m) => ({
      ...m,
      customer:
        db.select().from(customers).where(eq(customers.id, m.customerId)).get()
          ?.nama ?? "?",
      dari:
        db.select().from(salesmen).where(eq(salesmen.id, m.dariSalesmanId)).get()
          ?.nama ?? "?",
      ke:
        db.select().from(salesmen).where(eq(salesmen.id, m.keSalesmanId)).get()
          ?.nama ?? "?",
      oleh:
        db.select().from(users).where(eq(users.id, m.olehId)).get()?.username ??
        "?",
    }));

  const statuses = db
    .select()
    .from(statusLogs)
    .orderBy(desc(statusLogs.id))
    .limit(50)
    .all()
    .map((s) => ({
      ...s,
      customer:
        db.select().from(customers).where(eq(customers.id, s.customerId)).get()
          ?.nama ?? "?",
      oleh: s.olehId
        ? (db.select().from(users).where(eq(users.id, s.olehId)).get()
            ?.username ?? "?")
        : "system",
    }));

  return { user, mutations, statuses };
}

export default function AdminAudit() {
  const { user, mutations, statuses } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <PageHeader title="Log Audit" subtitle="Append-only — tidak bisa diedit/hapus" />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Mutasi salesman
      </h2>
      <div className="table-wrap mb-6">
        <table className="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Customer</th>
              <th>Dari → Ke</th>
              <th>Oleh</th>
            </tr>
          </thead>
          <tbody>
            {mutations.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  Belum ada mutasi.
                </td>
              </tr>
            ) : (
              mutations.map((m) => (
                <tr key={m.id}>
                  <td>{m.tanggal}</td>
                  <td>{m.customer}</td>
                  <td>
                    {m.dari} → {m.ke}
                  </td>
                  <td>{m.oleh}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Perubahan status
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Customer</th>
              <th>Tipe</th>
              <th>Oleh</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.id}>
                <td>{s.tanggal}</td>
                <td>{s.customer}</td>
                <td>
                  <StatusPill tone="muted">{s.tipe}</StatusPill>
                </td>
                <td>{s.oleh}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
