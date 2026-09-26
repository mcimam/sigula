import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import { destroyUserSession } from "~/lib/auth.server";

/** Only a POST (the "Keluar" button) ends a session: a link or an image on another page cannot log anyone out. */
export async function action({ request }: Route.ActionArgs) {
  return destroyUserSession(request);
}

export async function loader() {
  return redirect("/");
}
