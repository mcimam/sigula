import type { Route } from "./+types/admin.export.audit";
import {
  buildAuditExportXlsx,
  filteredAuditRows,
  type AuditListFilters,
} from "~/lib/audit-export.server";
import { requirePermission } from "~/lib/auth.server";
import {
  parseAuditColsParam,
  parseAuditSection,
  sanitizeExportBasename,
} from "~/lib/export-columns";
import { logExport, xlsxResponse } from "~/lib/export.server";
import { PERM } from "~/lib/permissions";
import { ACTIVITY_ENTITIES } from "~/lib/activity-entities";

function listFiltersFrom(params: URLSearchParams | FormData): AuditListFilters {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params.get(k);
    return typeof v === "string" ? v : null;
  };
  const entityParam = get("entity") ?? "";
  return {
    section: parseAuditSection(get("section")),
    q: get("q")?.trim().toLowerCase() ?? "",
    entity: (ACTIVITY_ENTITIES as readonly string[]).includes(entityParam)
      ? entityParam
      : "",
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.auditRead);
  const url = new URL(request.url);
  const filters = listFiltersFrom(url.searchParams);
  const columns = parseAuditColsParam(filters.section, url.searchParams.get("cols"));
  const filename = `${sanitizeExportBasename(
    url.searchParams.get("filename"),
    `audit-${filters.section}`,
  )}.xlsx`;
  const rows = filteredAuditRows(filters);
  const buf = await buildAuditExportXlsx(filters.section, rows, columns);
  logExport({
    listKey: `audit.${filters.section}`,
    mode: "filtered",
    filters,
    rowCount: rows.length,
    columnKeys: columns,
    actorId: user.id,
  });
  return xlsxResponse(buf, filename);
}
