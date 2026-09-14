import type { Route } from "./+types/reports.management";
import { requireRole } from "~/lib/auth.server";
import { buildManagementSummaryReport } from "~/lib/reports.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ["management", "admin"]);
  const buf = await buildManagementSummaryReport();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="management-summary.xlsx"`,
    },
  });
}
