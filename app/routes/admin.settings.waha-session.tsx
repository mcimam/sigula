import { data } from "react-router";

import type { Route } from "./+types/admin.settings.waha-session";
import { requirePermission } from "~/lib/auth.server";
import { PERM } from "~/lib/permissions";
import {
  getWahaSessionView,
  loginWahaSession,
  logoutWahaSession,
} from "~/lib/waha.server";
import type { WahaSessionResult } from "~/lib/waha-session";

// The response can carry a live WhatsApp QR (anyone who scans it can link the
// number), so it must never sit in a shared or browser cache. It is set twice on
// purpose: `data()` covers a direct request to this URL, while the `.data`
// request a fetcher makes ignores it and only honours the `headers` export.
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export const headers: Route.HeadersFunction = () => NO_STORE.headers;

/** Status poll for `WahaSessionCard`: the session view plus, while waiting for a scan, its QR. */
export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, PERM.settingsManage);
  const result: WahaSessionResult = {
    view: await getWahaSessionView(),
    error: null,
  };
  return data(result, NO_STORE);
}

export async function action({ request }: Route.ActionArgs) {
  await requirePermission(request, PERM.settingsManage);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "login") return data(await loginWahaSession(), NO_STORE);
  if (intent === "logout") return data(await logoutWahaSession(), NO_STORE);

  const result: WahaSessionResult = {
    view: await getWahaSessionView(),
    error: "Aksi tidak dikenali",
  };
  return data(result, { ...NO_STORE, status: 400 });
}
