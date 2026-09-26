import type { Route } from "./+types/reports.management";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { buildManagementSummaryReport } from "~/lib/reports.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, PERM.reportManagement);
  const buf = await buildManagementSummaryReport();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="management-summary.xlsx"`,
    },
  });
}
