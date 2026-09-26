import { eq } from "drizzle-orm";
import { redirect } from "react-router";

import type { Route } from "./+types/supervisor.customers.$id.reactivate";
import { db } from "~/db/client.server";
import { customers, salesmen } from "~/db/schema";
import { requireRole } from "~/lib/auth.server";
import { reactivateCustomer, subordinateIds } from "~/lib/masterdata.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireRole(request, "supervisor");
  const id = Number(params.id);
  const customer = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!customer) throw new Response("Not found", { status: 404 });
  const salesman = db
    .select()
    .from(salesmen)
    .where(eq(salesmen.id, customer.salesmanId))
    .get();
  if (!salesman || !subordinateIds(user.salesmanId!).includes(salesman.id)) {
    throw new Response("Forbidden", { status: 403 });
  }

  reactivateCustomer({ customerId: customer.id, actingUserId: user.id });
  return redirect(`/supervisor/salesmen/${salesman.id}`);
}
