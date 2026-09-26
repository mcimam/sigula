import { data } from "react-router";

import type { Route } from "./+types/comments";
import { requireUser } from "~/lib/auth.server";
import { isCommentEntity, postNote } from "~/lib/comments.server";

/**
 * The composer on every record panel posts here (a fetcher, so the panel stays open).
 * Access is decided per record in `postNote`; this route only reads the form.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const entityType = String(form.get("entity_type") ?? "");
  const entityId = Number(form.get("entity_id"));
  if (!isCommentEntity(entityType) || !Number.isInteger(entityId) || entityId <= 0) {
    throw new Response("Bad request", { status: 400 });
  }
  try {
    postNote({
      user,
      entityType,
      entityId,
      body: String(form.get("body") ?? ""),
      reasonCode: String(form.get("kode_alasan") ?? ""),
    });
    return { ok: true as const };
  } catch (err) {
    if (err instanceof Response) throw err;
    return data({ ok: false as const, error: err instanceof Error ? err.message : "Gagal mengirim" }, { status: 400 });
  }
}
