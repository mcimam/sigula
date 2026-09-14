import { redirect } from "react-router";

import type { Route } from "./+types/home";
import { getAuthUser, homeForRole } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getAuthUser(request);
  if (!user) throw redirect("/login");
  throw redirect(homeForRole(user.role));
}
