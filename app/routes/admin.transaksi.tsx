import type { ReactNode } from "react";
import { useActionData, useLoaderData } from "react-router";

import type { Route } from "./+types/admin.transaksi";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import {
  BulkActionBar,
  paginate,
  resolvePageSize,
  SelectAllCheckbox,
  TablePagination,
  TableToolbar,
  useRowSelection,
} from "~/components/DataTable";
import { UploadButton, type UploadPreviewView } from "~/components/UploadDialog";
import {
  AddLink,
  EditLink,
  parseDrawer,
  RecordDrawer,
  useDrawerHref,
  useRowOpen,
} from "~/components/RecordDrawer";
import { db } from "~/db/client.server";
import { listActivityFor } from "~/lib/activity.server";
import { customers, salesmen } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import {
  confirmImport,
  parsePreview,
  UnresolvedSheetsError,
  type ImportPreview,
  type ImportResult,
} from "~/lib/imports.server";
import {
  createTransaksi,
  deleteTransaksiMany,
  listTransaksi,
  updateTransaksi,
} from "~/lib/orders.server";
import { todayIso } from "~/lib/dates";
import { handleUpload, UploadError } from "~/lib/upload.server";

function describeImportPreview(preview: ImportPreview): UploadPreviewView {
  const customerCell = (nama: string, sheet: string) => (
    <>
      <span className="font-medium">{nama}</span>
      <div className="text-xs text-slate-400 sm:hidden">{sheet}</div>
    </>
  );
  return {
    stats: [
      { label: "Baru", value: preview.newCustomers.length, tone: "ok" },
      {
        label: "Update tanggal",
        value: preview.updatedCustomers.length,
        tone: "warn",
      },
      { label: "Tidak berubah", value: preview.unchangedCount, tone: "muted" },
    ],
    columns: [
      { header: "" },
      { header: "Customer" },
      { header: "Salesman", hideOnMobile: true },
      { header: "Tanggal order" },
    ],
    rows: [
      ...preview.newCustomers.map((r): ReactNode[] => [
        <StatusPill tone="ok">Baru</StatusPill>,
        customerCell(r.nama, r.sheetName),
        r.sheetName,
        r.lastOrderDate ?? "—",
      ]),
      ...preview.updatedCustomers.map((r): ReactNode[] => [
        <StatusPill tone="warn">Update</StatusPill>,
        customerCell(r.nama, r.sheetName),
        r.sheetName,
        <>
          <s className="text-slate-400">{r.oldDate ?? "—"}</s> →{" "}
          <b>{r.newDate}</b>
        </>,
      ]),
    ],
    emptyMessage:
      preview.unchangedCount > 0
        ? "Semua baris sudah sama dengan data saat ini — tidak ada yang perlu diimpor."
        : "Tidak ada baris yang bisa dibaca. Pastikan nama kolom dan format sheet sesuai template.",
    gate:
      preview.unknownSheets.length > 0
        ? {
            field: "treat_unknown",
            label: "Perlakukan sebagai salesman baru",
            notice: (
              <>
                Sheet belum dikenali sebagai salesman:{" "}
                <b>{preview.unknownSheets.join(", ")}</b>. Perbaiki nama sheet
                lalu unggah ulang, atau daftarkan sebagai salesman baru.
              </>
            ),
          }
        : undefined,
  };
}

function describeImportResult(result: ImportResult): ReactNode {
  return (
    <>
      <p>
        <b>{result.newCount}</b> customer baru, <b>{result.updatedCount}</b>{" "}
        tanggal order diperbarui, <b>{result.unchangedCount}</b> tidak berubah.
      </p>
      {result.newSalesmen.length > 0 ? (
        <p className="mt-1">Salesman baru: {result.newSalesmen.join(", ")}</p>
      ) : null}
    </>
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const pageSize = resolvePageSize(url.searchParams.get("pageSize"));
  const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const rows = listTransaksi(2000);
  const allCustomers = db.select().from(customers).all();
  const allSalesmen = db.select().from(salesmen).all();
  const enrichedAll = rows.map((t) => ({
    ...t,
    customerNama:
      allCustomers.find((c) => c.id === t.customerId)?.nama ?? `#${t.customerId}`,
    salesmanNama:
      allSalesmen.find((s) => s.id === t.salesmanId)?.nama ?? `#${t.salesmanId}`,
  }));

  const filtered = q
    ? enrichedAll.filter((t) =>
        [t.customerNama, t.salesmanNama, t.catatan, t.tanggalOrder]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : enrichedAll;

  const { rows: pageRows, total, totalPages, page } = paginate(
    filtered,
    requestedPage,
    pageSize,
  );

  const drawer = parseDrawer(url);
  const editing =
    drawer?.mode === "edit"
      ? (enrichedAll.find((t) => t.id === drawer.id) ?? null)
      : null;

  return {
    user,
    creating: drawer?.mode === "new",
    activity: editing ? listActivityFor("transaksi", editing.id) : [],
    transaksi: pageRows,
    total,
    page,
    pageSize,
    totalPages,
    q,
    editing,
    customers: allCustomers,
    salesmen: allSalesmen,
    flash: url.searchParams.get("flash"),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireRole(request, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const redirectFlash = (msg: string) =>
    Response.redirect(
      new URL(
        `/admin/transaksi?flash=${encodeURIComponent(msg)}`,
        request.url,
      ),
      303,
    );

  if (intent === "create") {
    createTransaksi({
      customerId: Number(form.get("customer_id")),
      salesmanId: Number(form.get("salesman_id")),
      tanggalOrder: String(form.get("tanggal_order") || todayIso()),
      catatan: String(form.get("catatan") ?? ""),
      actingUserId: user.id,
      sumber: "manual",
    });
    return redirectFlash("Transaksi ditambahkan");
  }

  if (intent === "update") {
    updateTransaksi({
      id: Number(form.get("transaksi_id")),
      customerId: Number(form.get("customer_id")),
      salesmanId: Number(form.get("salesman_id")),
      tanggalOrder: String(form.get("tanggal_order")),
      catatan: String(form.get("catatan") ?? ""),
      actingUserId: user.id,
    });
    return redirectFlash("Transaksi disimpan");
  }

  if (intent === "delete_many") {
    const ids = form
      .getAll("transaksi_id")
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    deleteTransaksiMany(ids, user.id);
    return redirectFlash(
      ids.length === 1 ? "1 transaksi dihapus" : `${ids.length} transaksi dihapus`,
    );
  }

  const upload = await handleUpload(form, {
    parse: parsePreview,
    confirm: async (buffer, f) => {
      try {
        return await confirmImport({
          buffer,
          actingUserId: user.id,
          treatUnknownSheetsAsNewSalesman: f.get("treat_unknown") === "on",
        });
      } catch (err) {
        if (err instanceof UnresolvedSheetsError) {
          throw new UploadError(
            `Sheet belum dikenali: ${err.unknownSheets.join(", ")}. Centang "Perlakukan sebagai salesman baru" atau perbaiki nama sheet.`,
          );
        }
        throw err;
      }
    },
    unreadableMessage:
      "File tidak bisa dibaca. Pastikan file .xlsx yang valid dan sesuai template.",
  });
  if (upload) return upload;

  return { error: "Aksi tidak dikenal" };
}

export default function AdminTransaksi() {
  const {
    user,
    transaksi,
    total,
    page,
    pageSize,
    totalPages,
    q,
    creating,
    editing,
    activity,
    customers: custList,
    salesmen: smList,
    flash,
  } = useLoaderData<typeof loader>();
  const drawerHref = useDrawerHref();
  const openRow = useRowOpen();
  const data = useActionData<typeof action>() as { error?: string } | undefined;

  const ids = transaksi.map((t) => t.id);
  const {
    selected,
    toggleAll,
    toggleOne,
    clear: clearSelection,
    allChecked,
    someChecked,
  } = useRowSelection(ids, `${q}:${page}:${pageSize}`);

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title="Transaksi"
        subtitle="Log order: customer 1—N transaksi, salesman 1—N transaksi. Import Excel lewat ikon unggah, atau kelola manual."
      />

      {data?.error ? (
        <div className="alert alert-danger mb-4">{data.error}</div>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Log transaksi
        </h2>
        <div className="flex items-center gap-2">
          <UploadButton
            title="Import dari Excel"
            description="Unggah file .xlsx untuk melihat preview sebelum diimpor."
            accept=".xlsx"
            template={{
              href: "/admin/transaksi/template.xlsx",
              note: (
                <>
                  Satu sheet per salesman (nama sheet = nama salesman), dengan
                  kolom <b>Nama Konsumen</b>, <b>Status (Lama/Baru)</b>, dan{" "}
                  <b>Tgl Terakhir Order</b>.
                </>
              ),
            }}
            confirmLabel="Konfirmasi import"
            describePreview={describeImportPreview}
            describeResult={describeImportResult}
          />
          <AddLink href={drawerHref("new")} label="Tambah transaksi" />
        </div>
      </div>

      <TableToolbar
        q={q}
        pageSize={pageSize}
        hiddenFields={{}}
        placeholder="Cari transaksi…"
      />

      <BulkActionBar
        count={selected.size}
        intent="delete_many"
        idName="transaksi_id"
        ids={[...selected]}
        onClear={clearSelection}
      />

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="checkbox-col">
                <SelectAllCheckbox
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  disabled={transaksi.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th>ID</th>
              <th>Tanggal</th>
              <th>Customer</th>
              <th className="hide-sm">Salesman</th>
              <th className="hide-sm">Catatan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transaksi.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-slate-500">
                  {q ? "Tidak ada transaksi yang cocok." : "Belum ada transaksi."}
                </td>
              </tr>
            ) : (
              transaksi.map((t) => (
                <tr
                  key={t.id}
                  className={`row-clickable ${editing?.id === t.id ? "row-active" : ""}`}
                  onClick={openRow(drawerHref(t.id))}
                >
                  <td className="align-top" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Pilih transaksi #${t.id}`}
                      checked={selected.has(t.id)}
                      onChange={(e) => toggleOne(t.id, e.target.checked)}
                    />
                  </td>
                  <td className="align-top">#{t.id}</td>
                  <td className="align-top">
                    <div>{t.tanggalOrder}</div>
                    <div className="text-xs text-slate-400">{t.sumber}</div>
                  </td>
                  <td className="align-top font-medium">{t.customerNama}</td>
                  <td className="align-top hide-sm">{t.salesmanNama}</td>
                  <td className="align-top hide-sm text-slate-500">{t.catatan}</td>
                  <td className="align-top">
                    <EditLink href={drawerHref(t.id)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <TablePagination
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          total={total}
          hrefForPage={(p) => `?q=${encodeURIComponent(q)}&pageSize=${pageSize}&page=${p}`}
          hiddenFields={{ q, pageSize: String(pageSize) }}
          emptyLabel="0 transaksi"
        />
      </div>

      {creating || editing ? (
        <RecordDrawer
          key={editing?.id ?? "new"}
          title={editing ? "Edit transaksi" : "Tambah transaksi"}
          subtitle={editing ? `#${editing.id} · ${editing.sumber}` : undefined}
          submitLabel={editing ? "Simpan" : "Tambah"}
          activity={editing ? activity : undefined}
          remove={
            editing
              ? { intent: "delete_many", idName: "transaksi_id", id: editing.id }
              : undefined
          }
          closeHref={drawerHref(null)}
        >
          <input type="hidden" name="intent" value={editing ? "update" : "create"} />
          {editing ? (
            <input type="hidden" name="transaksi_id" value={editing.id} />
          ) : null}
          <div className="form-field">
            <label htmlFor="d-customer">Customer</label>
            <select
              id="d-customer"
              name="customer_id"
              className="form-control"
              defaultValue={editing?.customerId}
              required
            >
              {custList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="d-salesman">Salesman</label>
            <select
              id="d-salesman"
              name="salesman_id"
              className="form-control"
              defaultValue={editing?.salesmanId}
              required
            >
              {smList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="d-tanggal">Tanggal order</label>
            <input
              id="d-tanggal"
              type="date"
              name="tanggal_order"
              className="form-control"
              defaultValue={editing?.tanggalOrder ?? todayIso()}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="d-catatan">Catatan</label>
            <input
              id="d-catatan"
              name="catatan"
              className="form-control"
              defaultValue={editing?.catatan ?? ""}
            />
          </div>
        </RecordDrawer>
      ) : null}
    </AppShell>
  );
}
