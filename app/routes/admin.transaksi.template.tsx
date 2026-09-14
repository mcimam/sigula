import type { Route } from "./+types/admin.transaksi.template";
import { requireRole } from "~/lib/auth.server";
import { buildImportTemplate } from "~/lib/imports.server";
import { db } from "~/db/client.server";
import { salesmen } from "~/db/schema";

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, "admin");
  const first = db.select().from(salesmen).all()[0];
  const buf = await buildImportTemplate({
    exampleSheetName: first?.nama,
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="sigula-transaksi-template.xlsx"',
    },
  });
}
