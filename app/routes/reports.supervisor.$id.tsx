import type { Route } from "./+types/reports.supervisor.$id";
import { requireRole } from "~/lib/auth.server";
import { buildSupervisorTeamReport } from "~/lib/reports.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireRole(request, ["supervisor", "admin"]);
  const idParam = params.id === "me" ? user.supervisorId : Number(params.id);
  if (idParam == null || Number.isNaN(idParam)) {
    throw new Response("Not found", { status: 404 });
  }
  if (user.role === "supervisor" && user.supervisorId !== idParam) {
    throw new Response("Forbidden", { status: 403 });
  }
  const buf = await buildSupervisorTeamReport(idParam);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="team-supervisor-${idParam}.xlsx"`,
    },
  });
}
