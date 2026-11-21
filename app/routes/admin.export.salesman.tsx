import type { Route } from "./+types/admin.export.salesman";
import { requirePermission } from "~/lib/auth.server";
import {
  parseSalesmanColsParam,
  sanitizeExportBasename,
} from "~/lib/export-columns";
import {
  buildSalesmanExportXlsx,
  logExport,
  xlsxResponse,
} from "~/lib/export.server";
import { filteredSalesmen } from "~/lib/masterdata-export.server";
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
  const columns = parseSalesmanColsParam(url.searchParams.get("cols"));
  const filename = `${sanitizeExportBasename(url.searchParams.get("filename"), "salesman")}.xlsx`;
  const rows = filteredSalesmen(filters);
  const buf = await buildSalesmanExportXlsx(rows, columns);
  logExport({
    listKey: "salesman",
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
  const columns = parseSalesmanColsParam(String(form.get("cols") ?? ""));
  const filename = `${sanitizeExportBasename(String(form.get("filename") ?? ""), "salesman")}.xlsx`;
  const requested = new Set(
    form
      .getAll("id")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  if (requested.size === 0) {
    throw new Response("Tidak ada baris dipilih", { status: 400 });
  }
  const allowed = filteredSalesmen(filters).filter((r) => requested.has(r.id));
  const buf = await buildSalesmanExportXlsx(allowed, columns);
  logExport({
    listKey: "salesman",
    mode: "selected",
    filters,
    rowCount: allowed.length,
    columnKeys: columns,
    actorId: user.id,
  });
  return xlsxResponse(buf, filename);
}
