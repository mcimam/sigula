import { eq } from "drizzle-orm";
import { redirect } from "react-router";

import type { Route } from "./+types/salesman.customers.$id.record-order";
import { db } from "~/db/client.server";
import { customers } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { recordOrder } from "~/lib/orders.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireRole(request, "salesman");
  const id = Number(params.id);
  const customer = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!customer) throw new Response("Not found", { status: 404 });
  if (customer.salesmanId !== user.salesmanId) {
    throw new Response("Forbidden", { status: 403 });
  }

  recordOrder({
    customerId: customer.id,
    actingUserId: user.id,
    sumber: "manual",
  });
  return redirect("/salesman");
}
