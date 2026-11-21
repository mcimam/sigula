import type { Route } from "./+types/admin.export.customer";
import { requirePermission } from "~/lib/auth.server";
import {
  filteredCustomers,
  toExportRows,
} from "~/lib/customer-export.server";
import { parseColsParam, sanitizeExportBasename } from "~/lib/export-columns";
import {
  buildCustomerExportXlsx,
  logExport,
  xlsxResponse,
} from "~/lib/export.server";
import { parseCustomerFilters } from "~/lib/list-filters/customer";
import { PERM } from "~/lib/permissions";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.masterdataManage);
  const url = new URL(request.url);
  const filters = parseCustomerFilters(url.searchParams);
  const columns = parseColsParam(url.searchParams.get("cols"));
  const filename = `${sanitizeExportBasename(url.searchParams.get("filename"))}.xlsx`;
  const rows = toExportRows(filteredCustomers(filters));
  const buf = await buildCustomerExportXlsx(rows, columns);
  logExport({
    listKey: "customer",
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
  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) {
    if (typeof v === "string" && k !== "id" && k !== "cols" && k !== "filename") {
      params.append(k, v);
    }
  }
  const filters = parseCustomerFilters(params);
  const columns = parseColsParam(String(form.get("cols") ?? ""));
  const filename = `${sanitizeExportBasename(String(form.get("filename") ?? ""))}.xlsx`;
  const requested = new Set(
    form
      .getAll("id")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  if (requested.size === 0) {
    throw new Response("Tidak ada baris dipilih", { status: 400 });
  }
  // BR-E1: only ids that still match the current filter set.
  const allowed = filteredCustomers(filters).filter((c) => requested.has(c.id));
  const rows = toExportRows(allowed);
  const buf = await buildCustomerExportXlsx(rows, columns);
  logExport({
    listKey: "customer",
    mode: "selected",
    filters,
    rowCount: rows.length,
    columnKeys: columns,
    actorId: user.id,
  });
  return xlsxResponse(buf, filename);
}
