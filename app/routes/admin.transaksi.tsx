import { Form, Link, useActionData, useLoaderData } from "react-router";

import type { Route } from "./+types/admin.transaksi";
import { AppShell, PageHeader } from "~/components/AppShell";
import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import {
  confirmImport,
  parsePreview,
  UnresolvedSheetsError,
  type ImportPreview,
} from "~/lib/imports.server";
import {
  createTransaksi,
  deleteTransaksi,
  listTransaksi,
  updateTransaksi,
} from "~/lib/orders.server";
import { todayIso } from "~/lib/dates";

const previewStore = new Map<string, { buffer: Buffer; expires: number }>(); // DEBT-006

function storePreview(buffer: Buffer) {
  const token = crypto.randomUUID();
  previewStore.set(token, {
    buffer,
    expires: Date.now() + 30 * 60 * 1000,
  });
  for (const [k, v] of previewStore) {
    if (v.expires < Date.now()) previewStore.delete(k);
  }
  return token;
}

function takePreview(token: string) {
  const entry = previewStore.get(token);
  if (!entry || entry.expires < Date.now()) {
    previewStore.delete(token);
    return null;
  }
  previewStore.delete(token);
  return entry.buffer;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const rows = listTransaksi(300);
  const allCustomers = db.select().from(customers).all();
  const allSalesmen = db.select().from(salesmen).all();
  const enriched = rows.map((t) => ({
    ...t,
    customerNama:
      allCustomers.find((c) => c.id === t.customerId)?.nama ?? `#${t.customerId}`,
    salesmanNama:
      allSalesmen.find((s) => s.id === t.salesmanId)?.nama ?? `#${t.salesmanId}`,
  }));
  return {
    user,
    transaksi: enriched,
    customers: allCustomers,
    salesmen: allSalesmen,
    flash: new URL(request.url).searchParams.get("flash"),
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
    });
    return redirectFlash("Transaksi disimpan");
  }

  if (intent === "delete") {
    deleteTransaksi(Number(form.get("transaksi_id")));
    return redirectFlash("Transaksi dihapus");
  }

  if (intent === "preview") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Pilih file .xlsx terlebih dahulu." };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { error: "File terlalu besar (maks 10 MB)." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await parsePreview(buffer);
    const token = storePreview(buffer);
    return { preview, token };
  }

  if (intent === "confirm") {
    const token = String(form.get("preview_token") ?? "");
    const treat = form.get("treat_unknown") === "on";
    const buffer = takePreview(token);
    if (!buffer) {
      return { error: "Preview kedaluwarsa — upload ulang." };
    }
    try {
      const result = await confirmImport({
        buffer,
        actingUserId: user.id,
        treatUnknownSheetsAsNewSalesman: treat,
      });
      return { result };
    } catch (err) {
      if (err instanceof UnresolvedSheetsError) {
        return {
          error: `Sheet belum dikenali: ${err.unknownSheets.join(", ")}. Centang opsi treat-as-new atau perbaiki nama sheet.`,
        };
      }
      throw err;
    }
  }

  return { error: "Aksi tidak dikenal" };
}

export default function AdminTransaksi() {
  const { user, transaksi, customers: custList, salesmen: smList, flash } =
    useLoaderData<typeof loader>();
  const data = useActionData<typeof action>() as
    | {
        error?: string;
        preview?: ImportPreview;
        token?: string;
        result?: {
          newCount: number;
          updatedCount: number;
          unchangedCount: number;
          newSalesmen: string[];
        };
      }
    | undefined;

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title="Transaksi"
        subtitle={
          <>
            Log order: customer 1—N transaksi, salesman 1—N transaksi. Upload
            Excel atau kelola manual.{" "}
            <Link
              to="/admin/transaksi/template.xlsx"
              className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-900"
              reloadDocument
            >
              Download template
            </Link>
          </>
        }
      />

      {data?.error ? (
        <div className="alert alert-danger mb-4">{data.error}</div>
      ) : null}
      {data?.result ? (
        <div className="alert alert-ok mb-4">
          Import selesai: {data.result.newCount} baru,{" "}
          {data.result.updatedCount} diupdate, {data.result.unchangedCount}{" "}
          tidak berubah
          {data.result.newSalesmen.length
            ? `; salesman baru: ${data.result.newSalesmen.join(", ")}`
            : ""}
          .
        </div>
      ) : null}

      <div className="card mb-6">
        <h2 className="mb-3 font-semibold">Upload Excel</h2>
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="preview" />
          <div className="form-field">
            <label htmlFor="file">File .xlsx</label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".xlsx"
              className="form-control"
              required
            />
          </div>
          <button type="submit" className="btn">
            Preview import
          </button>
        </Form>
      </div>

      {data?.preview && data.token ? (
        <div className="card mb-6">
          <h2 className="mb-3 font-semibold">Preview import</h2>
          <ul className="mb-4 space-y-1 text-sm text-slate-600">
            <li>Baru: {data.preview.newCustomers.length}</li>
            <li>Update tanggal: {data.preview.updatedCustomers.length}</li>
            <li>Tidak berubah: {data.preview.unchangedCount}</li>
            <li>
              Sheet tidak dikenal:{" "}
              {data.preview.unknownSheets.length
                ? data.preview.unknownSheets.join(", ")
                : "—"}
            </li>
          </ul>
          <Form method="post">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="preview_token" value={data.token} />
            {data.preview.unknownSheets.length > 0 ? (
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="treat_unknown" />
                Perlakukan sheet tidak dikenal sebagai salesman baru
              </label>
            ) : null}
            <button type="submit" className="btn">
              Konfirmasi import
            </button>
          </Form>
        </div>
      ) : null}

      <div className="card mb-6">
        <h2 className="mb-3 font-semibold">Tambah transaksi manual</h2>
        <Form method="post" className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="intent" value="create" />
          <div className="form-field mb-0">
            <label>Customer</label>
            <select name="customer_id" className="form-control" required>
              {custList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field mb-0">
            <label>Salesman</label>
            <select name="salesman_id" className="form-control" required>
              {smList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field mb-0">
            <label>Tanggal order</label>
            <input
              type="date"
              name="tanggal_order"
              className="form-control"
              defaultValue={todayIso()}
              required
            />
          </div>
          <div className="form-field mb-0">
            <label>Catatan</label>
            <input name="catatan" className="form-control" />
          </div>
          <button type="submit" className="btn md:col-span-4 md:w-fit">
            Tambah
          </button>
        </Form>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Log transaksi
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tanggal</th>
              <th>Customer / Salesman</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {transaksi.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  Belum ada transaksi.
                </td>
              </tr>
            ) : (
              transaksi.map((t) => (
                <tr key={t.id}>
                  <td className="align-top">#{t.id}</td>
                  <td className="align-top">
                    <div>{t.tanggalOrder}</div>
                    <div className="text-xs text-slate-400">{t.sumber}</div>
                  </td>
                  <td className="align-top">
                    <Form method="post" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="intent" value="update" />
                      <input type="hidden" name="transaksi_id" value={t.id} />
                      <div className="form-field mb-0">
                        <label>Customer</label>
                        <select
                          name="customer_id"
                          className="form-control"
                          defaultValue={t.customerId}
                        >
                          {custList.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nama}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field mb-0">
                        <label>Salesman</label>
                        <select
                          name="salesman_id"
                          className="form-control"
                          defaultValue={t.salesmanId}
                        >
                          {smList.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nama}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field mb-0">
                        <label>Tanggal</label>
                        <input
                          type="date"
                          name="tanggal_order"
                          className="form-control"
                          defaultValue={t.tanggalOrder}
                        />
                      </div>
                      <div className="form-field mb-0">
                        <label>Catatan</label>
                        <input
                          name="catatan"
                          className="form-control"
                          defaultValue={t.catatan}
                        />
                      </div>
                      <button type="submit" className="btn btn-sm">
                        Simpan
                      </button>
                    </Form>
                  </td>
                  <td className="align-top">
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="transaksi_id" value={t.id} />
                      <button type="submit" className="btn btn-sm btn-danger">
                        Hapus
                      </button>
                    </Form>
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
