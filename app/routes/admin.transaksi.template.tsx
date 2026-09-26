import type { Route } from "./+types/admin.transaksi.template";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { buildImportTemplate } from "~/lib/imports.server";
import { listLiveSalesmen } from "~/lib/masterdata.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, PERM.transaksiManage);
  const first = listLiveSalesmen()[0];
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
