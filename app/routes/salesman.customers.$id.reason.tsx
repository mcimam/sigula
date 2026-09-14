import { eq } from "drizzle-orm";
import { redirect } from "react-router";

import type { Route } from "./+types/salesman.customers.$id.reason";
import { db } from "~/db/client.server";
import { customers, type ReasonCode } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { submitReason } from "~/lib/reminders.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireRole(request, "salesman");
  const id = Number(params.id);
  const form = await request.formData();
  const kode = String(form.get("kode_alasan") ?? "") as ReasonCode;
  if (!["1", "2", "3"].includes(kode)) {
    throw new Response("Kode alasan tidak valid", { status: 400 });
  }

  const customer = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!customer) throw new Response("Not found", { status: 404 });
  if (customer.salesmanId !== user.salesmanId) {
    throw new Response("Forbidden", { status: 403 });
  }

  submitReason({
    customerId: customer.id,
    kodeAlasan: kode,
    actingUserId: user.id,
  });
  return redirect("/salesman");
}
