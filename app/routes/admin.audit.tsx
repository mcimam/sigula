import { eq } from "drizzle-orm";
import { Link, useLoaderData } from "react-router";

import type { Route } from "./+types/admin.audit";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { resolvePageSize, TablePagination } from "~/components/DataTable";
import { TableToolbar } from "~/components/TableSearch";
import { db } from "~/db/client.server";
import { users } from "~/db/schema";
import { ACTIVITY_ENTITIES } from "~/lib/activity-entities";
import { listActivityPage } from "~/lib/activity.server";
import { listInboundPage } from "~/lib/inbound.server";
import { listAssignmentMovesPage, listStatusChangesPage } from "~/lib/customer-history.server";
import { parsePage } from "~/lib/pagination";
import { customerName, salesmanName } from "~/lib/names.server";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  fieldLabel,
  formatStamp,
  formatValue,
} from "~/lib/activity-format";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";

const OPEN_HREF = {
  transaksi: (id: number) => `/admin/transaksi?edit=${id}`,
  customer: (id: number) => `/admin/masterdata?tab=customer&edit=${id}`,
  salesman: (id: number) => `/admin/masterdata?tab=salesman&edit=${id}`,
  user: (id: number) => `/admin/masterdata?tab=user&edit=${id}`,
  template: () => "/admin/settings?tab=templates",
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.auditRead);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const entityParam = url.searchParams.get("entity") ?? "";
  const entity = (ACTIVITY_ENTITIES as readonly string[]).includes(entityParam)
    ? entityParam
    : "";
  const pageSize = resolvePageSize(url.searchParams.get("pageSize"));

  // Each of the three lists on this page is paged in SQL, with its own page parameter.
  const activityTable = listActivityPage({
    entity,
    q,
    page: parsePage(url.searchParams.get("page")),
    pageSize,
  });

  const username = (id: number | null) =>
    id == null ? "system" : (db.select().from(users).where(eq(users.id, id)).get()?.username ?? "?");

  const moves = listAssignmentMovesPage(parsePage(url.searchParams.get("movePage")), pageSize);
  const mutations = {
    ...moves,
    rows: moves.rows.map((m) => ({
      id: m.id,
      tanggal: m.at,
      customer: customerName(m.customerId),
      dari: salesmanName(m.fromSalesmanId),
      ke: salesmanName(m.toSalesmanId),
      oleh: username(m.byId),
    })),
  };

  const changes = listStatusChangesPage(parsePage(url.searchParams.get("statusPage")), pageSize);
  const statuses = {
    ...changes,
    rows: changes.rows.map((s) => ({
      id: s.id,
      tanggal: s.changedAt,
      customer: customerName(s.customerId),
      tipe: s.reason || `${s.fromStatus} → ${s.toStatus}`,
      oleh: username(s.changedById),
    })),
  };

  const inbound = listInboundPage(parsePage(url.searchParams.get("replyPage")), pageSize);
  const replies = {
    ...inbound,
    rows: inbound.rows.map((r) => ({
      id: r.id,
      waktu: r.receivedAt,
      dari: r.salesmanId ? salesmanName(r.salesmanId) : `+${r.fromAddress}`,
      pesan: r.body,
      outcome: r.outcome,
      detail: r.detail,
      balasan: r.replyStatus,
    })),
  };

  return { user, mutations, statuses, replies, activityTable, q, entity, pageSize };
}

/** How each fate of an incoming message reads on the page. */
const REPLY_OUTCOMES = {
  recorded: { label: "dicatat", tone: "ok" },
  unrecognized: { label: "tidak dikenali", tone: "warn" },
  nothing_pending: { label: "tidak ada yang menunggu", tone: "muted" },
  unknown_sender: { label: "bukan salesman", tone: "muted" },
} as const;
const REPLY_SENT = { none: "—", sent: "terkirim", failed: "gagal terkirim" } as const;

export default function AdminAudit() {
  const { user, mutations, statuses, replies, activityTable, q, entity, pageSize } =
    useLoaderData<typeof loader>();
  const current = {
    page: activityTable.page,
    movePage: mutations.page,
    statusPage: statuses.page,
    replyPage: replies.page,
  };
  type PageKey = keyof typeof current;
  /** This page's URL with some page numbers (and/or the record type) changed. */
  const hrefFor = (over: Partial<typeof current> & { entity?: string }) => {
    const pages = { ...current, ...over };
    const p = new URLSearchParams();
    const e = over.entity ?? entity;
    if (e) p.set("entity", e);
    if (q) p.set("q", q);
    p.set("pageSize", String(pageSize));
    for (const key of Object.keys(current) as PageKey[]) p.set(key, String(pages[key]));
    return `?${p.toString()}`;
  };
  /** What a table's "Go to" form must carry along: everything except that table's own page. */
  const hiddenFor = (own: PageKey) => ({
    pageSize: String(pageSize),
    ...(q ? { q } : {}),
    ...(entity ? { entity } : {}),
    ...Object.fromEntries(
      (Object.keys(current) as PageKey[]).filter((k) => k !== own).map((k) => [k, String(current[k])]),
    ),
  });
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
              to={hrefFor({ entity: chip.id, page: 1 })}
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
                      tone={
                        a.action === "create" || a.action === "restore"
                          ? "ok"
                          : a.action === "delete"
                            ? "danger"
                            : "warn"
                      }
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
                              : formatValue(a.action === "create" || a.action === "restore" ? c.to : c.from)}
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
          hiddenFields={hiddenFor("page")}
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
            {mutations.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  Belum ada mutasi.
                </td>
              </tr>
            ) : (
              mutations.rows.map((m) => (
                <tr key={m.id}>
                  <td>{formatStamp(m.tanggal)}</td>
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
        <TablePagination
          page={mutations.page}
          pageSize={pageSize}
          totalPages={mutations.totalPages}
          total={mutations.total}
          hrefForPage={(p) => hrefFor({ movePage: p })}
          hiddenFields={hiddenFor("movePage")}
          pageParam="movePage"
          emptyLabel="0 mutasi"
        />
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
            {statuses.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  Belum ada perubahan status.
                </td>
              </tr>
            ) : (
              statuses.rows.map((s) => (
                <tr key={s.id}>
                  <td>{formatStamp(s.tanggal)}</td>
                  <td>{s.customer}</td>
                  <td>
                    <StatusPill tone="muted">{s.tipe}</StatusPill>
                  </td>
                  <td>{s.oleh}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <TablePagination
          page={statuses.page}
          pageSize={pageSize}
          totalPages={statuses.totalPages}
          total={statuses.total}
          hrefForPage={(p) => hrefFor({ statusPage: p })}
          hiddenFields={hiddenFor("statusPage")}
          pageParam="statusPage"
          emptyLabel="0 perubahan"
        />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Balasan WhatsApp
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Dari</th>
              <th>Pesan</th>
              <th>Hasil</th>
              <th className="hide-sm">Balasan kami</th>
            </tr>
          </thead>
          <tbody>
            {replies.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  Belum ada balasan WhatsApp yang masuk.
                </td>
              </tr>
            ) : (
              replies.rows.map((r) => (
                <tr key={r.id}>
                  <td className="align-top whitespace-nowrap">{formatStamp(r.waktu)}</td>
                  <td className="align-top">{r.dari}</td>
                  <td className="align-top whitespace-pre-wrap break-words">{r.pesan || "—"}</td>
                  <td className="align-top">
                    <StatusPill tone={REPLY_OUTCOMES[r.outcome].tone}>{REPLY_OUTCOMES[r.outcome].label}</StatusPill>
                    {r.detail ? <div className="mt-1 text-xs text-slate-500">{r.detail}</div> : null}
                  </td>
                  <td className="align-top hide-sm text-xs text-slate-600">{REPLY_SENT[r.balasan]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <TablePagination
          page={replies.page}
          pageSize={pageSize}
          totalPages={replies.totalPages}
          total={replies.total}
          hrefForPage={(p) => hrefFor({ replyPage: p })}
          hiddenFields={hiddenFor("replyPage")}
          pageParam="replyPage"
          emptyLabel="0 balasan"
        />
      </div>
    </AppShell>
  );
}
