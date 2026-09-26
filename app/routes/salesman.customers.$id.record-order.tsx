import { redirect } from "react-router";

import type { Route } from "./+types/salesman.customers.$id.record-order";
import { assertOwnOrAll } from "~/lib/access.server";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import { findLiveCustomer } from "~/lib/masterdata.server";
import { recordOrder } from "~/lib/orders.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, PERM.customerFollowUp);
  const id = Number(params.id);
  const customer = findLiveCustomer(id);
  if (!customer) throw new Response("Not found", { status: 404 });
  assertOwnOrAll(user, PERM.customerFollowUp, customer.salesmanId);

  recordOrder({
    customerId: customer.id,
    actingUserId: user.id,
    sumber: "manual",
  });
  return redirect("/salesman");
}
