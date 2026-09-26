import { eq } from "drizzle-orm";
import { useLoaderData } from "react-router";

import type { Route } from "./+types/admin.masterdata";
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
import {
  AddLink,
  EditLink,
  parseDrawer,
  RecordDrawer,
  useDrawerHref,
  useRowOpen,
} from "~/components/RecordDrawer";
import { db } from "~/db/client.server";
import {
  customers,
  profiles,
  salesmen,
  users,
  type Role,
} from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { listActivityFor } from "~/lib/activity.server";
import {
  createCustomer,
  createSalesman,
  createUserAccount,
  deleteCustomersMany,
  deleteSalesmenMany,
  deleteUsersMany,
  subordinateIds,
  updateCustomer,
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
  const pageSize = resolvePageSize(url.searchParams.get("pageSize"));
  const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const allSalesmen = db.select().from(salesmen).all();
  const allCustomers = db.select().from(customers).all();
  const allUsers = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: profiles.role,
      salesmanId: profiles.salesmanId,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .all();

  const customersFiltered = q
    ? allCustomers.filter((c) => {
        const sm = allSalesmen.find((s) => s.id === c.salesmanId);
        return (
          c.nama.toLowerCase().includes(q) ||
          (sm?.nama.toLowerCase().includes(q) ?? false)
        );
      })
    : allCustomers;
  const salesmenFiltered = q
    ? allSalesmen.filter(
        (s) =>
          s.nama.toLowerCase().includes(q) ||
          (s.nomorWa ?? "").toLowerCase().includes(q),
      )
    : allSalesmen;
  const usersFiltered = q
    ? allUsers.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q),
      )
    : allUsers;

  const drawer = parseDrawer(url);
  const editId = drawer?.mode === "edit" ? drawer.id : null;
  const editing = {
    customer:
      tab === "customer" && editId
        ? (allCustomers.find((c) => c.id === editId) ?? null)
        : null,
    salesman:
      tab === "salesman" && editId
        ? (allSalesmen.find((s) => s.id === editId) ?? null)
        : null,
    user:
      tab === "user" && editId ? (allUsers.find((u) => u.id === editId) ?? null) : null,
  };

  return {
    user,
    tab,
    q,
    pageSize,
    creating: drawer?.mode === "new",
    editing,
    flash: url.searchParams.get("flash"),
    customerTable: paginate(customersFiltered, requestedPage, pageSize),
    salesmen: allSalesmen,
    salesmanTable: paginate(salesmenFiltered, requestedPage, pageSize),
    // ADR-0004: any other salesman can be a supervisor, except this one and
    // its own subordinates (that would form a cycle).
    supervisorBlocked: editing.salesman
      ? [editing.salesman.id, ...subordinateIds(editing.salesman.id)]
      : [],
    userTable: paginate(usersFiltered, requestedPage, pageSize),
    activity: editing.customer
      ? listActivityFor("customer", editing.customer.id)
      : editing.salesman
        ? listActivityFor("salesman", editing.salesman.id)
        : editing.user
          ? listActivityFor("user", editing.user.id)
          : [],
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireRole(request, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const optionalId = (key: string) => (form.get(key) ? Number(form.get(key)) : null);
  const ids = (key: string) => form.getAll(key).map(Number).filter(Number.isFinite);
  const bulkMessage = (n: number, noun: string) =>
    n === 1 ? `1 ${noun} dihapus` : `${n} ${noun} dihapus`;

  try {
    if (intent === "create_customer") {
      const nama = String(form.get("nama") ?? "").trim();
      const salesmanId = Number(form.get("salesman_id"));
      if (!nama || !salesmanId) {
        return flashRedirect(request, "customer", "Nama & salesman wajib");
      }
      createCustomer({
        nama,
        salesmanId,
        tipeCustomer: String(form.get("tipe_customer") ?? "baru") as "lama" | "baru",
        orderCycleDays: Number(form.get("order_cycle_days") ?? 30),
        actingUserId: user.id,
      });
      return flashRedirect(request, "customer", "Customer ditambahkan");
    }

    if (intent === "update_customer") {
      updateCustomer({
        id: Number(form.get("customer_id")),
        nama: String(form.get("nama") ?? "").trim(),
        salesmanId: Number(form.get("salesman_id")),
        tipeCustomer: String(form.get("tipe_customer") ?? "lama") as "lama" | "baru",
        statusCustomer: String(form.get("status_customer") ?? "aktif") as
          | "aktif"
          | "inactive",
        orderCycleDays: Number(form.get("order_cycle_days")),
        actingUserId: user.id,
      });
      return flashRedirect(request, "customer", "Customer disimpan");
    }

    if (intent === "delete_many_customer") {
      const list = ids("customer_id");
      deleteCustomersMany(list, user.id);
      return flashRedirect(request, "customer", bulkMessage(list.length, "customer"));
    }

    if (intent === "create_salesman") {
      createSalesman({
        nama: String(form.get("nama") ?? ""),
        nomorWa: String(form.get("nomor_wa") ?? ""),
        supervisorId: optionalId("supervisor_id"),
        status: String(form.get("status") ?? "aktif") as "aktif" | "inactive",
        actingUserId: user.id,
      });
      return flashRedirect(request, "salesman", "Salesman ditambahkan");
    }

    if (intent === "update_salesman") {
      updateSalesman({
        id: Number(form.get("salesman_id")),
        nama: String(form.get("nama") ?? ""),
        nomorWa: String(form.get("nomor_wa") ?? ""),
        supervisorId: optionalId("supervisor_id"),
        status: String(form.get("status") ?? "aktif") as "aktif" | "inactive",
        actingUserId: user.id,
      });
      return flashRedirect(request, "salesman", "Salesman disimpan");
    }

    if (intent === "delete_many_salesman") {
      const list = ids("salesman_id");
      deleteSalesmenMany(list, user.id);
      return flashRedirect(request, "salesman", bulkMessage(list.length, "salesman"));
    }

    if (intent === "create_user") {
      await createUserAccount({
        username: String(form.get("username") ?? ""),
        displayName: String(form.get("display_name") ?? ""),
        password: String(form.get("password") ?? "sigula123"),
        role: String(form.get("role") ?? "admin") as Role,
        salesmanId: optionalId("salesman_id"),
        actingUserId: user.id,
      });
      return flashRedirect(request, "user", "User ditambahkan");
    }

    if (intent === "update_user") {
      await updateUserAccount({
        id: Number(form.get("user_id")),
        displayName: String(form.get("display_name") ?? ""),
        password: String(form.get("password") ?? ""),
        role: String(form.get("role") ?? "admin") as Role,
        salesmanId: optionalId("salesman_id"),
        actingUserId: user.id,
      });
      return flashRedirect(request, "user", "User disimpan");
    }

    if (intent === "delete_many_user") {
      const list = ids("user_id");
      deleteUsersMany(list, user.id);
      return flashRedirect(request, "user", bulkMessage(list.length, "user"));
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
  const {
    user,
    tab,
    flash,
    customerTable,
    salesmen: smList,
    salesmanTable,
    supervisorBlocked,
    activity,
    userTable,
    q,
    pageSize,
    creating,
    editing,
  } = data;
  const drawerHref = useDrawerHref();
  const openRow = useRowOpen();
  const smName = (id: number | null) => smList.find((s) => s.id === id)?.nama ?? "—";
  const supName = smName;
  const list = customerTable.rows;
  const smRows = salesmanTable.rows;
  const userList = userTable.rows;

  const customerSelection = useRowSelection(
    list.map((c) => c.id),
    `customer:${q}:${customerTable.page}:${pageSize}`,
  );
  const salesmanSelection = useRowSelection(
    smRows.map((s) => s.id),
    `salesman:${q}:${salesmanTable.page}:${pageSize}`,
  );
  const userSelection = useRowSelection(
    userList.filter((u) => u.id !== user.id).map((u) => u.id),
    `user:${q}:${userTable.page}:${pageSize}`,
  );

  return (
    <AppShell user={user} flash={flash}>
      <PageHeader
        title={`Data Master · ${TABS.find((t) => t.id === tab)?.label ?? "Customer"}`}
        subtitle="Kelola data (tambah / edit / hapus)"
      />

      {tab === "customer" ? (
        <>
          <div className="mb-3 flex justify-end">
            <AddLink href={drawerHref("new")} label="Tambah customer" />
          </div>

          <TableToolbar
            q={q}
            pageSize={pageSize}
            hiddenFields={{ tab: "customer" }}
            placeholder="Cari customer atau salesman…"
          />

          <BulkActionBar
            count={customerSelection.selected.size}
            intent="delete_many_customer"
            idName="customer_id"
            ids={[...customerSelection.selected]}
            onClear={customerSelection.clear}
          />

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="checkbox-col">
                    <SelectAllCheckbox
                      checked={customerSelection.allChecked}
                      indeterminate={
                        customerSelection.someChecked && !customerSelection.allChecked
                      }
                      disabled={list.length === 0}
                      onChange={customerSelection.toggleAll}
                    />
                  </th>
                  <th>Customer</th>
                  <th className="hide-sm">Salesman</th>
                  <th className="hide-sm">Tipe</th>
                  <th className="hide-sm">Siklus</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-slate-500">
                      {q ? "Tidak ada customer yang cocok." : "Belum ada customer."}
                    </td>
                  </tr>
                ) : (
                  list.map((c) => (
                    <tr
                      key={c.id}
                      className={`row-clickable ${editing.customer?.id === c.id ? "row-active" : ""}`}
                      onClick={openRow(drawerHref(c.id))}
                    >
                      <td className="align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${c.nama}`}
                          checked={customerSelection.selected.has(c.id)}
                          onChange={(e) =>
                            customerSelection.toggleOne(c.id, e.target.checked)
                          }
                        />
                      </td>
                      <td className="font-medium align-top">{c.nama}</td>
                      <td className="align-top hide-sm">{smName(c.salesmanId)}</td>
                      <td className="align-top hide-sm">{c.tipeCustomer}</td>
                      <td className="align-top hide-sm">{c.orderCycleDays} hari</td>
                      <td className="align-top">
                        <StatusPill tone={c.statusCustomer === "aktif" ? "ok" : "muted"}>
                          {c.statusCustomer}
                        </StatusPill>
                      </td>
                      <td className="align-top">
                        <EditLink href={drawerHref(c.id)} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <TablePagination
              page={customerTable.page}
              pageSize={pageSize}
              totalPages={customerTable.totalPages}
              total={customerTable.total}
              hrefForPage={(p) =>
                `?tab=customer&q=${encodeURIComponent(q)}&pageSize=${pageSize}&page=${p}`
              }
              hiddenFields={{ tab: "customer", q, pageSize: String(pageSize) }}
              emptyLabel="0 customer"
            />
          </div>

          {creating || editing.customer ? (
            <RecordDrawer
              key={editing.customer?.id ?? "new"}
              title={editing.customer ? "Edit customer" : "Tambah customer"}
              subtitle={editing.customer?.nama}
              submitLabel={editing.customer ? "Simpan" : "Tambah"}
              activity={editing.customer ? activity : undefined}
              remove={
                editing.customer
                  ? { intent: "delete_many_customer", idName: "customer_id", id: editing.customer.id }
                  : undefined
              }
              closeHref={drawerHref(null)}
            >
              <input
                type="hidden"
                name="intent"
                value={editing.customer ? "update_customer" : "create_customer"}
              />
              {editing.customer ? (
                <input type="hidden" name="customer_id" value={editing.customer.id} />
              ) : null}
              <div className="form-field">
                <label htmlFor="d-nama">Nama</label>
                <input
                  id="d-nama"
                  name="nama"
                  className="form-control"
                  defaultValue={editing.customer?.nama ?? ""}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="d-salesman">Salesman</label>
                <select
                  id="d-salesman"
                  name="salesman_id"
                  className="form-control"
                  defaultValue={editing.customer?.salesmanId}
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
                <label htmlFor="d-tipe">Tipe</label>
                <select
                  id="d-tipe"
                  name="tipe_customer"
                  className="form-control"
                  defaultValue={editing.customer?.tipeCustomer ?? "baru"}
                >
                  <option value="lama">Lama</option>
                  <option value="baru">Baru</option>
                </select>
              </div>
              {editing.customer ? (
                <div className="form-field">
                  <label htmlFor="d-status">Status</label>
                  <select
                    id="d-status"
                    name="status_customer"
                    className="form-control"
                    defaultValue={editing.customer.statusCustomer}
                  >
                    <option value="aktif">Aktif</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              ) : null}
              <div className="form-field">
                <label htmlFor="d-siklus">Siklus order (hari)</label>
                <input
                  id="d-siklus"
                  name="order_cycle_days"
                  type="number"
                  min={1}
                  className="form-control"
                  defaultValue={editing.customer?.orderCycleDays ?? 30}
                />
              </div>
            </RecordDrawer>
          ) : null}
        </>
      ) : null}

      {tab === "salesman" ? (
        <>
          <div className="mb-3 flex justify-end">
            <AddLink href={drawerHref("new")} label="Tambah salesman" />
          </div>

          <TableToolbar
            q={q}
            pageSize={pageSize}
            hiddenFields={{ tab: "salesman" }}
            placeholder="Cari salesman atau nomor WA…"
          />

          <BulkActionBar
            count={salesmanSelection.selected.size}
            intent="delete_many_salesman"
            idName="salesman_id"
            ids={[...salesmanSelection.selected]}
            onClear={salesmanSelection.clear}
          />

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="checkbox-col">
                    <SelectAllCheckbox
                      checked={salesmanSelection.allChecked}
                      indeterminate={
                        salesmanSelection.someChecked && !salesmanSelection.allChecked
                      }
                      disabled={smRows.length === 0}
                      onChange={salesmanSelection.toggleAll}
                    />
                  </th>
                  <th>Salesman</th>
                  <th className="hide-sm">WA</th>
                  <th className="hide-sm">Supervisor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {smRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-slate-500">
                      {q ? "Tidak ada salesman yang cocok." : "Belum ada salesman."}
                    </td>
                  </tr>
                ) : (
                  smRows.map((s) => (
                    <tr
                      key={s.id}
                      className={`row-clickable ${editing.salesman?.id === s.id ? "row-active" : ""}`}
                      onClick={openRow(drawerHref(s.id))}
                    >
                      <td className="align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${s.nama}`}
                          checked={salesmanSelection.selected.has(s.id)}
                          onChange={(e) =>
                            salesmanSelection.toggleOne(s.id, e.target.checked)
                          }
                        />
                      </td>
                      <td className="font-medium align-top">{s.nama}</td>
                      <td className="align-top hide-sm">{s.nomorWa || "—"}</td>
                      <td className="align-top hide-sm">{supName(s.supervisorId)}</td>
                      <td className="align-top">
                        <StatusPill tone={s.status === "aktif" ? "ok" : "muted"}>
                          {s.status}
                        </StatusPill>
                      </td>
                      <td className="align-top">
                        <EditLink href={drawerHref(s.id)} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <TablePagination
              page={salesmanTable.page}
              pageSize={pageSize}
              totalPages={salesmanTable.totalPages}
              total={salesmanTable.total}
              hrefForPage={(p) =>
                `?tab=salesman&q=${encodeURIComponent(q)}&pageSize=${pageSize}&page=${p}`
              }
              hiddenFields={{ tab: "salesman", q, pageSize: String(pageSize) }}
              emptyLabel="0 salesman"
            />
          </div>

          {creating || editing.salesman ? (
            <RecordDrawer
              key={editing.salesman?.id ?? "new"}
              title={editing.salesman ? "Edit salesman" : "Tambah salesman"}
              subtitle={editing.salesman?.nama}
              submitLabel={editing.salesman ? "Simpan" : "Tambah"}
              activity={editing.salesman ? activity : undefined}
              remove={
                editing.salesman
                  ? { intent: "delete_many_salesman", idName: "salesman_id", id: editing.salesman.id }
                  : undefined
              }
              closeHref={drawerHref(null)}
            >
              <input
                type="hidden"
                name="intent"
                value={editing.salesman ? "update_salesman" : "create_salesman"}
              />
              {editing.salesman ? (
                <input type="hidden" name="salesman_id" value={editing.salesman.id} />
              ) : null}
              <div className="form-field">
                <label htmlFor="d-nama">Nama</label>
                <input
                  id="d-nama"
                  name="nama"
                  className="form-control"
                  defaultValue={editing.salesman?.nama ?? ""}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="d-wa">Nomor WA</label>
                <input
                  id="d-wa"
                  name="nomor_wa"
                  className="form-control"
                  defaultValue={editing.salesman?.nomorWa ?? ""}
                />
              </div>
              <div className="form-field">
                <label htmlFor="d-supervisor">Supervisor (atasan)</label>
                <select
                  id="d-supervisor"
                  name="supervisor_id"
                  className="form-control"
                  defaultValue={editing.salesman?.supervisorId ?? ""}
                >
                  <option value="">—</option>
                  {smList
                    .filter((sup) => !supervisorBlocked.includes(sup.id))
                    .map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.nama}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="d-status">Status</label>
                <select
                  id="d-status"
                  name="status"
                  className="form-control"
                  defaultValue={editing.salesman?.status ?? "aktif"}
                >
                  <option value="aktif">Aktif</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </RecordDrawer>
          ) : null}
        </>
      ) : null}

      {tab === "user" ? (
        <>
          <div className="mb-3 flex justify-end">
            <AddLink href={drawerHref("new")} label="Tambah user" />
          </div>

          <TableToolbar
            q={q}
            pageSize={pageSize}
            hiddenFields={{ tab: "user" }}
            placeholder="Cari username, nama, atau role…"
          />

          <BulkActionBar
            count={userSelection.selected.size}
            intent="delete_many_user"
            idName="user_id"
            ids={[...userSelection.selected]}
            onClear={userSelection.clear}
          />

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="checkbox-col">
                    <SelectAllCheckbox
                      checked={userSelection.allChecked}
                      indeterminate={userSelection.someChecked && !userSelection.allChecked}
                      disabled={userList.length === 0}
                      onChange={userSelection.toggleAll}
                    />
                  </th>
                  <th>User</th>
                  <th className="hide-sm">Nama tampilan</th>
                  <th className="hide-sm">Tertaut ke</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {userList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-slate-500">
                      {q ? "Tidak ada user yang cocok." : "Belum ada user."}
                    </td>
                  </tr>
                ) : (
                  userList.map((u) => (
                    <tr
                      key={u.id}
                      className={`row-clickable ${editing.user?.id === u.id ? "row-active" : ""}`}
                      onClick={openRow(drawerHref(u.id))}
                    >
                      <td className="align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={
                            u.id === user.id
                              ? "Akun Anda sendiri — tidak bisa dihapus massal"
                              : `Pilih ${u.username}`
                          }
                          checked={userSelection.selected.has(u.id)}
                          disabled={u.id === user.id}
                          onChange={(e) => userSelection.toggleOne(u.id, e.target.checked)}
                        />
                      </td>
                      <td className="align-top">
                        <div className="font-medium">{u.username}</div>
                        <div className="text-xs text-slate-500">
                          {u.role}
                          {u.id === user.id ? " · Anda" : ""}
                        </div>
                      </td>
                      <td className="align-top hide-sm">{u.displayName}</td>
                      <td className="align-top hide-sm">
                        {u.role === "salesman" || u.role === "supervisor"
                          ? smName(u.salesmanId)
                          : "—"}
                      </td>
                      <td className="align-top">
                        <EditLink href={drawerHref(u.id)} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <TablePagination
              page={userTable.page}
              pageSize={pageSize}
              totalPages={userTable.totalPages}
              total={userTable.total}
              hrefForPage={(p) =>
                `?tab=user&q=${encodeURIComponent(q)}&pageSize=${pageSize}&page=${p}`
              }
              hiddenFields={{ tab: "user", q, pageSize: String(pageSize) }}
              emptyLabel="0 user"
            />
          </div>

          {creating || editing.user ? (
            <RecordDrawer
              key={editing.user?.id ?? "new"}
              title={editing.user ? "Edit user" : "Tambah user"}
              subtitle={editing.user?.username}
              submitLabel={editing.user ? "Simpan" : "Tambah"}
              activity={editing.user ? activity : undefined}
              remove={
                editing.user
                  ? { intent: "delete_many_user", idName: "user_id", id: editing.user.id, disabledReason: editing.user.id === user.id ? "Akun Anda sendiri tidak bisa dihapus" : undefined }
                  : undefined
              }
              closeHref={drawerHref(null)}
            >
              <input
                type="hidden"
                name="intent"
                value={editing.user ? "update_user" : "create_user"}
              />
              {editing.user ? (
                <input type="hidden" name="user_id" value={editing.user.id} />
              ) : (
                <div className="form-field">
                  <label htmlFor="d-username">Username</label>
                  <input
                    id="d-username"
                    name="username"
                    className="form-control"
                    autoComplete="off"
                    required
                  />
                </div>
              )}
              <div className="form-field">
                <label htmlFor="d-display">Nama tampilan</label>
                <input
                  id="d-display"
                  name="display_name"
                  className="form-control"
                  defaultValue={editing.user?.displayName ?? ""}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="d-password">
                  {editing.user ? "Password baru (opsional)" : "Password"}
                </label>
                <input
                  id="d-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className="form-control"
                  defaultValue={editing.user ? undefined : "sigula123"}
                />
              </div>
              <div className="form-field">
                <label htmlFor="d-role">Role</label>
                <select
                  id="d-role"
                  name="role"
                  className="form-control"
                  defaultValue={editing.user?.role ?? "admin"}
                >
                  <option value="admin">Admin</option>
                  <option value="salesman">Salesman</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="management">Management</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="d-salesman">Salesman (untuk role salesman / supervisor)</label>
                <select
                  id="d-salesman"
                  name="salesman_id"
                  className="form-control"
                  defaultValue={editing.user?.salesmanId ?? ""}
                >
                  <option value="">—</option>
                  {smList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
            </RecordDrawer>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
