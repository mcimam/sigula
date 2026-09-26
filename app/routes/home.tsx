import { redirect } from "react-router";

import type { Route } from "./+types/home";
import { getAuthUser } from "~/lib/auth.server";
import { homeFor } from "~/lib/permissions";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getAuthUser(request);
  if (!user) throw redirect("/login");
  const home = homeFor(user);
  // Signed in, but no role gives them anything to open.
  if (!home) throw new Response("Akun Anda belum punya hak akses. Hubungi admin.", { status: 403 });
  throw redirect(home);
}
