import type { Route } from "./+types/reports.supervisor.$id";
import { requirePermission } from "~/lib/auth.server";
import { assertOwnOrAll } from "~/lib/access.server";
import { PERM } from "~/lib/permissions";
import { buildSupervisorTeamReport } from "~/lib/reports.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requirePermission(request, PERM.reportTeam);
  const idParam = params.id === "me" ? user.salesmanId : Number(params.id);
  if (idParam == null || Number.isNaN(idParam)) {
    throw new Response("Not found", { status: 404 });
  }
  assertOwnOrAll(user, PERM.reportTeam, idParam);
  const buf = await buildSupervisorTeamReport(idParam);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="team-supervisor-${idParam}.xlsx"`,
    },
  });
}
