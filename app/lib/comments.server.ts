import { and, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { alive, transaksi, users } from "~/db/schema";
import { COMMENT_ENTITIES, type CommentEntity } from "~/lib/activity-entities";
import { addComment, normalizeComment } from "~/lib/activity.server";
import { assertOwnOrAll } from "~/lib/access.server";
import type { AuthUser } from "~/lib/auth.server";
import { submitReason } from "~/lib/follow-ups.server";
import { findLiveCustomer, findLiveSalesman } from "~/lib/masterdata.server";
import { can, PERM } from "~/lib/permissions";

export const isCommentEntity = (value: string): value is CommentEntity =>
  (COMMENT_ENTITIES as readonly string[]).includes(value);

const forbidden = () => new Response("Forbidden", { status: 403 });
const notFound = () => new Response("Not found", { status: 404 });

/**
 * Who may read and write a record's thread: whoever manages that kind of record
 * (`transaksi.manage`, `masterdata.manage`) and, for a customer, the salesman it
 * belongs to (`customer.follow_up`, within its scope — ADR-0007). Throws a 403
 * `Response`, or a 404 for a record that does not exist (or is in the trash).
 */
export function assertCanUseThread(user: AuthUser, entityType: CommentEntity, entityId: number) {
  switch (entityType) {
    case "transaksi":
      if (!can(user, PERM.transaksiManage)) throw forbidden();
      if (!db.select({ id: transaksi.id }).from(transaksi).where(and(eq(transaksi.id, entityId), alive(transaksi))).get()) {
        throw notFound();
      }
      return;
    case "salesman":
      if (!can(user, PERM.masterdataManage)) throw forbidden();
      if (!findLiveSalesman(entityId)) throw notFound();
      return;
    case "user":
      if (!can(user, PERM.masterdataManage)) throw forbidden();
      if (!db.select({ id: users.id }).from(users).where(and(eq(users.id, entityId), alive(users))).get()) {
        throw notFound();
      }
      return;
    case "customer": {
      if (!can(user, PERM.masterdataManage) && !can(user, PERM.customerFollowUp)) throw forbidden();
      const customer = findLiveCustomer(entityId);
      if (!customer) throw notFound();
      if (can(user, PERM.masterdataManage)) return;
      assertOwnOrAll(user, PERM.customerFollowUp, customer.salesmanId);
    }
  }
}

/**
 * The composer on a record's panel: a comment, and on a customer optionally the reason
 * it is late (BR-4) — recorded as a follow-up, which lands in the customer's activity
 * like any other log entry. A message written with a reason follows it. Needs text or a
 * reason; a reason needs `customer.follow_up` for that customer's salesman. Throws a
 * readable `Error` for bad input and a 403/404 `Response` for access.
 */
export function postNote(opts: {
  user: AuthUser;
  entityType: CommentEntity;
  entityId: number;
  body: string;
  reasonCode?: string;
}) {
  const { user, entityType, entityId } = opts;
  assertCanUseThread(user, entityType, entityId);
  const body = normalizeComment(opts.body);
  const reasonCode = opts.reasonCode?.trim() ?? "";

  if (reasonCode) {
    if (entityType !== "customer") throw new Error("Alasan hanya untuk customer");
    assertOwnOrAll(user, PERM.customerFollowUp, findLiveCustomer(entityId)!.salesmanId);
    submitReason({ customerId: entityId, kodeAlasan: reasonCode, actingUserId: user.id });
  } else if (!body) {
    throw new Error("Komentar tidak boleh kosong");
  }
  if (body) addComment({ entityType, entityId, body, authorId: user.id });
}
