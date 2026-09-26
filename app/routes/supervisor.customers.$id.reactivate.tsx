import { redirect } from "react-router";

import type { Route } from "./+types/supervisor.customers.$id.reactivate";
import { assertInTeamOrAll } from "~/lib/access.server";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import {
  findLiveCustomer,
  findLiveSalesman,
  reactivateCustomer,
} from "~/lib/masterdata.server";

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requirePermission(request, PERM.customerReactivate);
  const id = Number(params.id);
  const customer = findLiveCustomer(id);
  if (!customer) throw new Response("Not found", { status: 404 });
  const salesman = findLiveSalesman(customer.salesmanId);
  if (!salesman) throw new Response("Forbidden", { status: 403 });
  assertInTeamOrAll(user, PERM.customerReactivate, salesman.id);

  reactivateCustomer({ customerId: customer.id, actingUserId: user.id });
  return redirect(`/supervisor/salesmen/${salesman.id}`);
}
