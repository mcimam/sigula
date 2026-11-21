import { isNotNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, users } from "~/db/schema";
import { attachWhatsapp } from "~/lib/contacts.server";
import { listLiveSalesmen } from "~/lib/masterdata.server";
import { salesmanName } from "~/lib/names.server";
import { rolesForUsers } from "~/lib/roles.server";
import { listDeletedSalesmen } from "~/lib/trash.server";

export type MasterListFilters = { q: string; trash: boolean };

export type SalesmanExportRow = {
  id: number;
  nama: string;
  nomorWa: string;
  supervisor: string;
  status: string;
  createdAt: string;
};

export type UserExportRow = {
  id: number;
  username: string;
  displayName: string;
  roles: string;
  salesman: string;
  isActive: string;
  lastLoginAt: string;
  createdAt: string;
};

export function filteredSalesmen(filters: MasterListFilters): SalesmanExportRow[] {
  const q = filters.q;
  const matches = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

  if (filters.trash) {
    return listDeletedSalesmen()
      .filter((s) => matches(s.nama, s.nomorWa))
      .map((s) => ({
        id: s.id,
        nama: s.nama,
        nomorWa: s.nomorWa ?? "",
        supervisor: s.supervisorNama,
        status: s.status,
        createdAt: s.createdAt,
      }));
  }

  return attachWhatsapp(listLiveSalesmen())
    .filter((s) => matches(s.nama, s.nomorWa))
    .map((s) => ({
      id: s.id,
      nama: s.nama,
      nomorWa: s.nomorWa ?? "",
      supervisor: salesmanName(s.supervisorId) ?? "—",
      status: s.status,
      createdAt: s.createdAt,
    }));
}

export function filteredUsers(filters: MasterListFilters): UserExportRow[] {
  const q = filters.q;
  const matches = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

  const rows = filters.trash
    ? db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          salesmanId: users.salesmanId,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isNotNull(users.deletedAt))
        .all()
    : db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          salesmanId: users.salesmanId,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(alive(users))
        .all();

  const rolesByUser = rolesForUsers(rows.map((u) => u.id));
  return rows
    .map((u) => {
      const roleNames = (rolesByUser.get(u.id) ?? []).map((r) => r.name);
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        roles: roleNames.join(" · ") || "—",
        salesman: salesmanName(u.salesmanId) ?? "—",
        isActive: filters.trash ? "—" : u.isActive ? "ya" : "tidak",
        lastLoginAt: u.lastLoginAt ?? "",
        createdAt: u.createdAt,
        roleNames,
      };
    })
    .filter((u) => matches(u.username, u.displayName, u.roleNames.join(" ")))
    .map(({ roleNames: _r, ...row }) => row);
}
