import { desc, eq } from "drizzle-orm";
import { Link, useLoaderData } from "react-router";

import type { Route } from "./+types/admin.audit";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import {
  paginate,
  resolvePageSize,
  TablePagination,
  TableToolbar,
} from "~/components/DataTable";
import { db } from "~/db/client.server";
import {
  ACTIVITY_ENTITIES,
  customers,
  mutationLogs,
  salesmen,
  statusLogs,
  users,
} from "~/db/schema";
import { listRecentActivity } from "~/lib/activity.server";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  fieldLabel,
  formatStamp,
  formatValue,
} from "~/lib/activity-format";
import { requireRole } from "~/lib/auth.server";

const OPEN_HREF = {
  transaksi: (id: number) => `/admin/transaksi?edit=${id}`,
  customer: (id: number) => `/admin/masterdata?tab=customer&edit=${id}`,
  salesman: (id: number) => `/admin/masterdata?tab=salesman&edit=${id}`,
  user: (id: number) => `/admin/masterdata?tab=user&edit=${id}`,
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const entityParam = url.searchParams.get("entity") ?? "";
  const entity = (ACTIVITY_ENTITIES as readonly string[]).includes(entityParam)
    ? entityParam
    : "";
  const pageSize = resolvePageSize(url.searchParams.get("pageSize"));
  const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const activityFiltered = listRecentActivity(2000).filter(
    (a) =>
      (!entity || a.entityType === entity) &&
      (!q ||
        [
          a.entityLabel,
          a.actorName,
          ENTITY_LABELS[a.entityType],
          ACTION_LABELS[a.action],
          ...Object.entries(a.changes).flatMap(([k, c]) => [
            fieldLabel(k),
            String(c.from ?? ""),
            String(c.to ?? ""),
          ]),
        ].some((v) => v.toLowerCase().includes(q))),
  );
  const activityTable = paginate(activityFiltered, requestedPage, pageSize);

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

  return { user, mutations, statuses, activityTable, q, entity, pageSize };
}

export default function AdminAudit() {
  const { user, mutations, statuses, activityTable, q, entity, pageSize } =
    useLoaderData<typeof loader>();
  const hrefFor = (over: { entity?: string; page?: number }) => {
    const p = new URLSearchParams();
    const e = over.entity ?? entity;
    if (e) p.set("entity", e);
    if (q) p.set("q", q);
    p.set("pageSize", String(pageSize));
    p.set("page", String(over.page ?? 1));
    return `?${p.toString()}`;
  };
  return (
    <AppShell user={user}>
      <PageHeader title="Log Audit" subtitle="Append-only — tidak bisa diedit/hapus" />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Aktivitas record
      </h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {[{ id: "", label: "Semua" }, ...ACTIVITY_ENTITIES.map((e) => ({ id: e, label: ENTITY_LABELS[e] }))].map(
          (chip) => (
            <Link
              key={chip.id || "all"}
              to={hrefFor({ entity: chip.id })}
              className={`btn btn-sm ${entity === chip.id ? "" : "btn-outline"}`}
            >
              {chip.label}
            </Link>
          ),
        )}
      </div>
      <TableToolbar
        q={q}
        pageSize={pageSize}
        hiddenFields={entity ? { entity } : {}}
        placeholder="Cari record, pelaku, atau perubahan…"
      />
      <div className="table-wrap mb-8">
        <table className="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Record</th>
              <th>Aksi</th>
              <th className="hide-sm">Oleh</th>
              <th className="hide-sm">Perubahan</th>
            </tr>
          </thead>
          <tbody>
            {activityTable.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {q || entity ? "Tidak ada aktivitas yang cocok." : "Belum ada aktivitas tercatat."}
                </td>
              </tr>
            ) : (
              activityTable.rows.map((a) => (
                <tr key={a.id}>
                  <td className="align-top whitespace-nowrap">{formatStamp(a.createdAt)}</td>
                  <td className="align-top">
                    <div className="text-xs text-slate-400">{ENTITY_LABELS[a.entityType]}</div>
                    {a.action === "delete" ? (
                      <span className="font-medium">{a.entityLabel}</span>
                    ) : (
                      <Link
                        className="font-medium"
                        to={OPEN_HREF[a.entityType](a.entityId)}
                      >
                        {a.entityLabel}
                      </Link>
                    )}
                  </td>
                  <td className="align-top">
                    <StatusPill
                      tone={a.action === "create" ? "ok" : a.action === "delete" ? "danger" : "warn"}
                    >
                      {ACTION_LABELS[a.action]}
                    </StatusPill>
                  </td>
                  <td className="align-top hide-sm">{a.actorName || "sistem"}</td>
                  <td className="align-top hide-sm text-xs text-slate-600">
                    {Object.entries(a.changes).length === 0
                      ? "—"
                      : Object.entries(a.changes).map(([key, c]) => (
                          <div key={key}>
                            <span className="font-semibold">{fieldLabel(key)}</span>{" "}
                            {a.action === "update"
                              ? `${formatValue(c.from)} → ${formatValue(c.to)}`
                              : formatValue(a.action === "create" ? c.to : c.from)}
                          </div>
                        ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <TablePagination
          page={activityTable.page}
          pageSize={pageSize}
          totalPages={activityTable.totalPages}
          total={activityTable.total}
          hrefForPage={(p) => hrefFor({ page: p })}
          hiddenFields={{ q, pageSize: String(pageSize), ...(entity ? { entity } : {}) }}
          emptyLabel="0 aktivitas"
        />
      </div>

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
