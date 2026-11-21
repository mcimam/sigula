import type { Route } from "./+types/admin.export.user";
import { requirePermission } from "~/lib/auth.server";
import {
  parseUserColsParam,
  sanitizeExportBasename,
} from "~/lib/export-columns";
import {
  buildUserExportXlsx,
  logExport,
  xlsxResponse,
} from "~/lib/export.server";
import { filteredUsers } from "~/lib/masterdata-export.server";
import { PERM } from "~/lib/permissions";

function listFiltersFrom(params: URLSearchParams | FormData) {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params.get(k);
    return typeof v === "string" ? v : null;
  };
  return {
    q: get("q")?.trim().toLowerCase() ?? "",
    trash: get("trash") === "1",
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.masterdataManage);
  const url = new URL(request.url);
  const filters = listFiltersFrom(url.searchParams);
  const columns = parseUserColsParam(url.searchParams.get("cols"));
  const filename = `${sanitizeExportBasename(url.searchParams.get("filename"), "user")}.xlsx`;
  const rows = filteredUsers(filters);
  const buf = await buildUserExportXlsx(rows, columns);
  logExport({
    listKey: "user",
    mode: "filtered",
    filters,
    rowCount: rows.length,
    columnKeys: columns,
    actorId: user.id,
  });
  return xlsxResponse(buf, filename);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", { status: 405 });
  }
  const user = await requirePermission(request, PERM.masterdataManage);
  const form = await request.formData();
  const filters = listFiltersFrom(form);
  const columns = parseUserColsParam(String(form.get("cols") ?? ""));
  const filename = `${sanitizeExportBasename(String(form.get("filename") ?? ""), "user")}.xlsx`;
  const requested = new Set(
    form
      .getAll("id")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  if (requested.size === 0) {
    throw new Response("Tidak ada baris dipilih", { status: 400 });
  }
  const allowed = filteredUsers(filters).filter((r) => requested.has(r.id));
  const buf = await buildUserExportXlsx(allowed, columns);
  logExport({
    listKey: "user",
    mode: "selected",
    filters,
    rowCount: allowed.length,
    columnKeys: columns,
    actorId: user.id,
  });
  return xlsxResponse(buf, filename);
}
