import { eq } from "drizzle-orm";
import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/admin.masterdata";
import { AppShell, PageHeader, StatusPill } from "~/components/AppShell";
import { db } from "~/db/client.server";
import {
  customers,
  profiles,
  salesmen,
  supervisors,
  users,
  type Role,
} from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import {
  clampCycleDays,
  createSalesman,
  createUserAccount,
  deleteCustomerRecord,
  deleteSalesman,
  deleteUserAccount,
  reassignCustomer,
  updateSalesman,
  updateUserAccount,
} from "~/lib/masterdata.server";

function flashRedirect(request: Request, tab: string, message: string) {
  return Response.redirect(
    new URL(
      `/admin/masterdata?tab=${tab}&flash=${encodeURIComponent(message)}`,
      request.url,
    ),
    303,
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireRole(request, "admin");
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "customer";
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const allSalesmen = db.select().from(salesmen).all();
  const allSupervisors = db.select().from(supervisors).all();
  let customerList = db.select().from(customers).all();
  if (q && tab === "customer") {
    customerList = customerList.filter((c) => {
      const sm = allSalesmen.find((s) => s.id === c.salesmanId);
      return (
        c.nama.toLowerCase().includes(q) ||
        (sm?.nama.toLowerCase().includes(q) ?? false)
      );
    });
  }

  const userRows = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: profiles.role,
      salesmanId: profiles.salesmanId,
      supervisorId: profiles.supervisorId,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .all();

  return {
    user,
    tab,
    q,
    flash: url.searchParams.get("flash"),
    customers: customerList,
    salesmen: allSalesmen,
    supervisors: allSupervisors,
    users: userRows,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireRole(request, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create_customer") {
      const nama = String(form.get("nama") ?? "").trim();
      const salesmanId = Number(form.get("salesman_id"));
      const tipe = String(form.get("tipe_customer") ?? "baru") as "lama" | "baru";
      const cycle = clampCycleDays(Number(form.get("order_cycle_days") ?? 30));
      if (!nama || !salesmanId) {
        return flashRedirect(request, "customer", "Nama & salesman wajib");
      }
      db.insert(customers)
        .values({
          nama,
          salesmanId,
          tipeCustomer: tipe,
          orderCycleDays: cycle,
          statusCustomer: "aktif",
        })
        .run();
      return flashRedirect(request, "customer", "Customer ditambahkan");
    }

    if (intent === "update_customer") {
      const id = Number(form.get("customer_id"));
      const nama = String(form.get("nama") ?? "").trim();
      const cycle = clampCycleDays(Number(form.get("order_cycle_days")));
      const toSalesmanId = Number(form.get("salesman_id"));
      const tipe = String(form.get("tipe_customer") ?? "lama") as "lama" | "baru";
      const status = String(form.get("status_customer") ?? "aktif") as
        | "aktif"
        | "inactive";
      const customer = db.select().from(customers).where(eq(customers.id, id)).get();
      if (!customer) throw new Response("Not found", { status: 404 });
      if (toSalesmanId !== customer.salesmanId) {
        reassignCustomer({
          customerId: id,
          toSalesmanId,
          actingUserId: user.id,
        });
      }
      db.update(customers)
        .set({
          nama: nama || customer.nama,
          orderCycleDays: cycle,
          tipeCustomer: tipe,
          statusCustomer: status,
        })
        .where(eq(customers.id, id))
        .run();
      return flashRedirect(request, "customer", "Customer disimpan");
    }

    if (intent === "delete_customer") {
      deleteCustomerRecord(Number(form.get("customer_id")));
      return flashRedirect(request, "customer", "Customer dihapus");
    }

    if (intent === "create_salesman") {
      createSalesman({
        nama: String(form.get("nama") ?? ""),
        nomorWa: String(form.get("nomor_wa") ?? ""),
        supervisorId: form.get("supervisor_id")
          ? Number(form.get("supervisor_id"))
          : null,
        status: String(form.get("status") ?? "aktif") as "aktif" | "inactive",
      });
      return flashRedirect(request, "salesman", "Salesman ditambahkan");
    }

    if (intent === "update_salesman") {
      updateSalesman({
        id: Number(form.get("salesman_id")),
        nama: String(form.get("nama") ?? ""),
        nomorWa: String(form.get("nomor_wa") ?? ""),
        supervisorId: form.get("supervisor_id")
          ? Number(form.get("supervisor_id"))
          : null,
        status: String(form.get("status") ?? "aktif") as "aktif" | "inactive",
      });
      return flashRedirect(request, "salesman", "Salesman disimpan");
    }

    if (intent === "delete_salesman") {
      deleteSalesman(Number(form.get("salesman_id")));
      return flashRedirect(request, "salesman", "Salesman dihapus");
    }

    if (intent === "create_user") {
      const role = String(form.get("role") ?? "admin") as Role;
      await createUserAccount({
        username: String(form.get("username") ?? ""),
        displayName: String(form.get("display_name") ?? ""),
        password: String(form.get("password") ?? "sigula123"),
        role,
        salesmanId: form.get("salesman_id")
          ? Number(form.get("salesman_id"))
          : null,
        supervisorId: form.get("supervisor_id")
          ? Number(form.get("supervisor_id"))
          : null,
      });
      return flashRedirect(request, "user", "User ditambahkan");
    }

    if (intent === "update_user") {
      const role = String(form.get("role") ?? "admin") as Role;
      await updateUserAccount({
        id: Number(form.get("user_id")),
        displayName: String(form.get("display_name") ?? ""),
        password: String(form.get("password") ?? ""),
        role,
        salesmanId: form.get("salesman_id")
          ? Number(form.get("salesman_id"))
          : null,
        supervisorId: form.get("supervisor_id")
          ? Number(form.get("supervisor_id"))
          : null,
      });
      return flashRedirect(request, "user", "User disimpan");
    }

    if (intent === "delete_user") {
      const id = Number(form.get("user_id"));
      if (id === user.id) {
        return flashRedirect(request, "user", "Tidak bisa menghapus akun sendiri");
      }
      deleteUserAccount(id);
      return flashRedirect(request, "user", "User dihapus");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gagal menyimpan";
    const tab =
      intent.includes("salesman") ? "salesman" : intent.includes("user") ? "user" : "customer";
    return flashRedirect(request, tab, msg);
  }

  return flashRedirect(request, "customer", "Aksi tidak dikenal");
}

const TABS = [
  { id: "customer", label: "Customer" },
  { id: "salesman", label: "Salesman" },
  { id: "user", label: "User" },
] as const;

export default function AdminMasterdata() {
  const data = useLoaderData<typeof loader>();
  const { user, tab, flash, customers: list, salesmen: smList, supervisors: supList, users: userList, q } =
    data;

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title="Data Master"
        subtitle="Kelola customer, salesman, dan user (tambah / edit / hapus)"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={`/admin/masterdata?tab=${t.id}`}
            className={`btn btn-sm ${tab === t.id ? "" : "btn-outline"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "customer" ? (
        <>
          <div className="card mb-6">
            <h2 className="mb-3 font-semibold">Tambah customer</h2>
            <Form method="post" className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="intent" value="create_customer" />
              <div className="form-field mb-0">
                <label htmlFor="nama">Nama</label>
                <input id="nama" name="nama" className="form-control" required />
              </div>
              <div className="form-field mb-0">
                <label htmlFor="salesman_id">Salesman</label>
                <select id="salesman_id" name="salesman_id" className="form-control" required>
                  {smList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field mb-0">
                <label htmlFor="tipe_customer">Tipe</label>
                <select id="tipe_customer" name="tipe_customer" className="form-control">
                  <option value="baru">Baru</option>
                  <option value="lama">Lama</option>
                </select>
              </div>
              <div className="form-field mb-0">
                <label htmlFor="order_cycle_days">Siklus (hari)</label>
                <input
                  id="order_cycle_days"
                  name="order_cycle_days"
                  type="number"
                  min={1}
                  defaultValue={30}
                  className="form-control"
                />
              </div>
              <button type="submit" className="btn md:col-span-4 md:w-fit">
                Tambah
              </button>
            </Form>
          </div>

          <Form method="get" className="mb-4">
            <input type="hidden" name="tab" value="customer" />
            <input
              className="form-control"
              name="q"
              defaultValue={q}
              placeholder="Cari customer atau salesman…"
            />
          </Form>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium align-top">{c.nama}</td>
                    <td className="align-top">
                      <StatusPill tone={c.statusCustomer === "aktif" ? "ok" : "muted"}>
                        {c.statusCustomer}
                      </StatusPill>
                    </td>
                    <td colSpan={2}>
                      <Form method="post" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="intent" value="update_customer" />
                        <input type="hidden" name="customer_id" value={c.id} />
                        <div className="form-field mb-0">
                          <label>Nama</label>
                          <input name="nama" defaultValue={c.nama} className="form-control" />
                        </div>
                        <div className="form-field mb-0">
                          <label>Salesman</label>
                          <select name="salesman_id" className="form-control" defaultValue={c.salesmanId}>
                            {smList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nama}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Tipe</label>
                          <select name="tipe_customer" className="form-control" defaultValue={c.tipeCustomer}>
                            <option value="lama">Lama</option>
                            <option value="baru">Baru</option>
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Status</label>
                          <select
                            name="status_customer"
                            className="form-control"
                            defaultValue={c.statusCustomer}
                          >
                            <option value="aktif">Aktif</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Siklus</label>
                          <input
                            name="order_cycle_days"
                            type="number"
                            min={1}
                            defaultValue={c.orderCycleDays}
                            className="form-control"
                          />
                        </div>
                        <button type="submit" className="btn btn-sm">
                          Simpan
                        </button>
                      </Form>
                      <Form method="post" className="mt-2">
                        <input type="hidden" name="intent" value="delete_customer" />
                        <input type="hidden" name="customer_id" value={c.id} />
                        <button type="submit" className="btn btn-sm btn-danger">
                          Hapus
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "salesman" ? (
        <>
          <div className="card mb-6">
            <h2 className="mb-3 font-semibold">Tambah salesman</h2>
            <Form method="post" className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="intent" value="create_salesman" />
              <div className="form-field mb-0">
                <label>Nama</label>
                <input name="nama" className="form-control" required />
              </div>
              <div className="form-field mb-0">
                <label>Nomor WA</label>
                <input name="nomor_wa" className="form-control" />
              </div>
              <div className="form-field mb-0">
                <label>Supervisor</label>
                <select name="supervisor_id" className="form-control">
                  <option value="">—</option>
                  {supList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field mb-0">
                <label>Status</label>
                <select name="status" className="form-control" defaultValue="aktif">
                  <option value="aktif">Aktif</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <button type="submit" className="btn md:col-span-4 md:w-fit">
                Tambah
              </button>
            </Form>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Salesman</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {smList.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium align-top">{s.nama}</td>
                    <td>
                      <Form method="post" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="intent" value="update_salesman" />
                        <input type="hidden" name="salesman_id" value={s.id} />
                        <div className="form-field mb-0">
                          <label>Nama</label>
                          <input name="nama" defaultValue={s.nama} className="form-control" />
                        </div>
                        <div className="form-field mb-0">
                          <label>WA</label>
                          <input name="nomor_wa" defaultValue={s.nomorWa} className="form-control" />
                        </div>
                        <div className="form-field mb-0">
                          <label>Supervisor</label>
                          <select
                            name="supervisor_id"
                            className="form-control"
                            defaultValue={s.supervisorId ?? ""}
                          >
                            <option value="">—</option>
                            {supList.map((sup) => (
                              <option key={sup.id} value={sup.id}>
                                {sup.nama}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Status</label>
                          <select name="status" className="form-control" defaultValue={s.status}>
                            <option value="aktif">Aktif</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                        <button type="submit" className="btn btn-sm">
                          Simpan
                        </button>
                      </Form>
                      <Form method="post" className="mt-2">
                        <input type="hidden" name="intent" value="delete_salesman" />
                        <input type="hidden" name="salesman_id" value={s.id} />
                        <button type="submit" className="btn btn-sm btn-danger">
                          Hapus
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "user" ? (
        <>
          <div className="card mb-6">
            <h2 className="mb-3 font-semibold">Tambah user</h2>
            <Form method="post" className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="intent" value="create_user" />
              <div className="form-field mb-0">
                <label>Username</label>
                <input name="username" className="form-control" required />
              </div>
              <div className="form-field mb-0">
                <label>Nama tampilan</label>
                <input name="display_name" className="form-control" required />
              </div>
              <div className="form-field mb-0">
                <label>Password</label>
                <input name="password" type="password" className="form-control" defaultValue="sigula123" />
              </div>
              <div className="form-field mb-0">
                <label>Role</label>
                <select name="role" className="form-control" defaultValue="admin">
                  <option value="admin">Admin</option>
                  <option value="salesman">Salesman</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="management">Management</option>
                </select>
              </div>
              <div className="form-field mb-0">
                <label>Link salesman (jika role salesman)</label>
                <select name="salesman_id" className="form-control">
                  <option value="">—</option>
                  {smList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field mb-0">
                <label>Link supervisor (jika role supervisor)</label>
                <select name="supervisor_id" className="form-control">
                  <option value="">—</option>
                  {supList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn md:col-span-3 md:w-fit">
                Tambah
              </button>
            </Form>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {userList.map((u) => (
                  <tr key={u.id}>
                    <td className="align-top">
                      <div className="font-medium">{u.username}</div>
                      <div className="text-xs text-slate-500">{u.role}</div>
                    </td>
                    <td>
                      <Form method="post" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="intent" value="update_user" />
                        <input type="hidden" name="user_id" value={u.id} />
                        <div className="form-field mb-0">
                          <label>Nama tampilan</label>
                          <input
                            name="display_name"
                            defaultValue={u.displayName}
                            className="form-control"
                          />
                        </div>
                        <div className="form-field mb-0">
                          <label>Password baru (opsional)</label>
                          <input name="password" type="password" className="form-control" />
                        </div>
                        <div className="form-field mb-0">
                          <label>Role</label>
                          <select name="role" className="form-control" defaultValue={u.role}>
                            <option value="admin">Admin</option>
                            <option value="salesman">Salesman</option>
                            <option value="supervisor">Supervisor</option>
                            <option value="management">Management</option>
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Salesman</label>
                          <select
                            name="salesman_id"
                            className="form-control"
                            defaultValue={u.salesmanId ?? ""}
                          >
                            <option value="">—</option>
                            {smList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nama}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-field mb-0">
                          <label>Supervisor</label>
                          <select
                            name="supervisor_id"
                            className="form-control"
                            defaultValue={u.supervisorId ?? ""}
                          >
                            <option value="">—</option>
                            {supList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nama}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button type="submit" className="btn btn-sm">
                          Simpan
                        </button>
                      </Form>
                      <Form method="post" className="mt-2">
                        <input type="hidden" name="intent" value="delete_user" />
                        <input type="hidden" name="user_id" value={u.id} />
                        <button type="submit" className="btn btn-sm btn-danger">
                          Hapus
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
