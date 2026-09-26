import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/salesman._index";
import { AppShell, PageHeader, StatusPill, StatTile } from "~/components/AppShell";
import {
  EditLink,
  parseDrawer,
  ReadonlyField,
  RecordDrawer,
  useDrawerHref,
  useRowOpen,
} from "~/components/RecordDrawer";
import { canOwnOrAll, requireSalesmanId } from "~/lib/access.server";
import { FEED_PAGE_PARAM } from "~/lib/activity-format";
import { listFeedFor } from "~/lib/activity.server";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { daysSinceOrder, isOverdue, orderStanding, orderStatusText } from "~/lib/dates";
import { listFollowUpReasons } from "~/lib/follow-ups.server";
import { liveCustomersOf } from "~/lib/masterdata.server";
import { parsePage } from "~/lib/pagination";
import { pendingCustomerIds } from "~/lib/pending.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.customerFollowUp);
  const salesmanId = requireSalesmanId(user);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const all = liveCustomersOf(salesmanId);

  const pendingIds = pendingCustomerIds();
  const pending = all
    .filter((c) => pendingIds.has(c.id))
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

  // The customer's panel: where a salesman gives the reason a customer is late (the
  // reason is a log entry on the customer). Only the salesman's own customers open.
  const drawer = parseDrawer(url);
  const own = drawer?.mode === "edit" ? all.find((c) => c.id === drawer.id) : undefined;
  const panel = own
    ? {
        customer: { ...own, ...orderStanding(own.lastOrderDate, own.orderCycleDays) },
        activity: {
          feed: listFeedFor("customer", own.id, parsePage(url.searchParams.get(FEED_PAGE_PARAM))),
          entityType: "customer" as const,
          entityId: own.id,
          reasons:
            isOverdue(own.lastOrderDate, own.orderCycleDays) &&
            own.statusCustomer === "aktif" &&
            canOwnOrAll(user, PERM.customerFollowUp, own.salesmanId)
              ? listFollowUpReasons().map(({ code, label }) => ({ code, label }))
              : undefined,
        },
      }
    : null;

  return {
    user,
    pending,
    panel,
    stats: {
      total: all.length,
      pending: pending.length,
      followUp,
    },
    q,
  };
}

export default function SalesmanDashboard() {
  const { user, pending, panel, stats, q } = useLoaderData<typeof loader>();
  const drawerHref = useDrawerHref();
  const openRow = useRowOpen();

  return (
    <AppShell user={user}>
      <PageHeader
        title="Dashboard Salesman"
        subtitle="Customer yang menunggu balasan reminder. Buka customer untuk mengisi alasan keterlambatan."
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
                <tr
                  key={c.id}
                  className={`row-clickable ${panel?.customer.id === c.id ? "row-active" : ""}`}
                  onClick={openRow(drawerHref(c.id))}
                >
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
                      <EditLink href={drawerHref(c.id)} label="Alasan & aktivitas" />
                      <Form
                        method="post"
                        action={`/salesman/customers/${c.id}/record-order`}
                        onClick={(e) => e.stopPropagation()}
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

      {panel ? (
        <RecordDrawer
          key={panel.customer.id}
          viewOnly
          title={panel.customer.nama}
          subtitle="Customer"
          closeHref={drawerHref(null)}
          activity={panel.activity}
        >
          <ReadonlyField id="d-tipe" label="Tipe" value={panel.customer.tipeCustomer} />
          <ReadonlyField id="d-siklus" label="Siklus order" value={`${panel.customer.orderCycleDays} hari`} />
          <ReadonlyField
            id="d-last-order"
            label="Tanggal transaksi terakhir"
            value={panel.customer.lastOrderDate ?? "Belum pernah order"}
          />
          <ReadonlyField
            id="d-order-status"
            label="Status order"
            value={orderStatusText(panel.customer)}
          />
        </RecordDrawer>
      ) : null}
    </AppShell>
  );
}
