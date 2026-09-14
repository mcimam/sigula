import type { Route } from "./+types/reports.salesman.$id";
import { requireRole } from "~/lib/auth.server";
import { buildSalesmanReminderReport } from "~/lib/reports.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireRole(request, ["salesman", "admin"]);
  const idParam = params.id === "me" ? user.salesmanId : Number(params.id);
  if (idParam == null || Number.isNaN(idParam)) {
    throw new Response("Not found", { status: 404 });
  }
  if (user.role === "salesman" && user.salesmanId !== idParam) {
    throw new Response("Forbidden", { status: 403 });
  }
  const buf = await buildSalesmanReminderReport(idParam);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reminder-salesman-${idParam}.xlsx"`,
    },
  });
}
