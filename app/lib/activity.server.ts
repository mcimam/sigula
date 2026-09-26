import { and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  activityLogs,
  recordComments,
  users,
  type ActivityAction,
  type ActivityEntity,
} from "~/db/schema";
import type { CommentEntity } from "~/lib/activity-entities";
import {
  ACTION_LABELS,
  COMMENT_MAX_LENGTH,
  ENTITY_LABELS,
  FIELD_LABELS,
  type ActivityItem,
  type Changes,
  type CommentItem,
  type FeedEntry,
  type FeedPage,
  type FieldChange,
} from "~/lib/activity-format";
import { nowIso } from "~/lib/dates";
import { pageWindow } from "~/lib/pagination";

type Value = string | number | null | undefined;

const norm = (v: Value): string | number | null =>
  v === undefined || v === null || v === "" ? null : v;

/** Only fields whose value actually changed, keyed by field name. */
export function diffChanges(
  before: Record<string, Value>,
  after: Record<string, Value>,
): Changes {
  const out: Changes = {};
  for (const key of Object.keys(after)) {
    const from = norm(before[key]);
    const to = norm(after[key]);
    if (String(from) !== String(to)) out[key] = { from, to };
  }
  return out;
}

/** create → every set field as `null → value`; delete → `value → null`. */
export function snapshotChanges(
  values: Record<string, Value>,
  action: "create" | "delete",
): Changes {
  const out: Changes = {};
  for (const [key, raw] of Object.entries(values)) {
    const v = norm(raw);
    if (v === null) continue;
    out[key] = action === "create" ? { from: null, to: v } : { from: v, to: null };
  }
  return out;
}

/** The name to snapshot onto a log entry or comment; "" when the system acted. */
function displayNameOf(userId: number | null) {
  if (userId === null) return "";
  return db.select({ n: users.displayName }).from(users).where(eq(users.id, userId)).get()?.n ?? "";
}

export function logActivity(opts: {
  entityType: ActivityEntity;
  entityId: number;
  entityLabel: string;
  action: ActivityAction;
  actorId?: number | null;
  changes?: Changes;
}) {
  // An update that changed nothing is not an event.
  if (
    opts.action === "update" &&
    (!opts.changes || Object.keys(opts.changes).length === 0)
  ) {
    return;
  }
  const actorId = opts.actorId ?? null;
  const actorName = displayNameOf(actorId);
  db.insert(activityLogs)
    .values({
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
      action: opts.action,
      actorId,
      actorName,
      changes: JSON.stringify(opts.changes ?? {}),
      createdAt: nowIso(),
    })
    .run();
}

function toItem(row: typeof activityLogs.$inferSelect): ActivityItem {
  let changes: Record<string, FieldChange> = {};
  try {
    changes = JSON.parse(row.changes) as Record<string, FieldChange>;
  } catch {
    changes = {};
  }
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    action: row.action,
    actorName: row.actorName,
    createdAt: row.createdAt,
    changes,
  };
}

/** Entries per page of a record's feed (its panel is narrow, so a short page). */
export const FEED_PAGE_SIZE = 10;

/** The comment text as stored (trimmed); throws a readable error when it is over-long. */
export function normalizeComment(raw: string) {
  const body = raw.trim();
  if (body.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Komentar maksimal ${COMMENT_MAX_LENGTH} karakter`);
  }
  return body;
}

/** Leaves a message on a record's panel. Throws a readable error for an empty or over-long one. */
export function addComment(opts: {
  entityType: CommentEntity;
  entityId: number;
  body: string;
  authorId: number;
}) {
  const body = normalizeComment(opts.body);
  if (!body) throw new Error("Komentar tidak boleh kosong");
  db.insert(recordComments)
    .values({
      entityType: opts.entityType,
      entityId: opts.entityId,
      body,
      authorId: opts.authorId,
      authorName: displayNameOf(opts.authorId),
      createdAt: nowIso(),
    })
    .run();
}

const toComment = (row: typeof recordComments.$inferSelect): CommentItem => ({
  id: row.id,
  authorName: row.authorName,
  body: row.body,
  createdAt: row.createdAt,
});

/**
 * A record's log entries and comments as one feed, newest first, one page at a time.
 * Both tables are paged together in SQL (a UNION of their keys), so page N is right
 * however the two are interleaved. Within the same second a comment sorts before the
 * log entry, so "reason logged, then message" reads in that order.
 */
export function listFeedFor(
  entityType: ActivityEntity,
  entityId: number,
  requestedPage = 1,
  pageSize = FEED_PAGE_SIZE,
): FeedPage {
  const countOf = (table: typeof activityLogs | typeof recordComments) =>
    db
      .select({ n: count() })
      .from(table)
      .where(and(eq(table.entityType, entityType), eq(table.entityId, entityId)))
      .get()!.n;
  const total = countOf(activityLogs) + countOf(recordComments);
  const { page, totalPages, offset } = pageWindow(total, requestedPage, pageSize);

  const keys = db.all<{ kind: "log" | "comment"; id: number }>(sql`
    SELECT kind, id FROM (
      SELECT 'log' AS kind, id, created_at FROM activity_logs
        WHERE entity_type = ${entityType} AND entity_id = ${entityId}
      UNION ALL
      SELECT 'comment' AS kind, id, created_at FROM record_comments
        WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    )
    ORDER BY created_at DESC, kind ASC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}`);

  const idsOf = (kind: "log" | "comment") => keys.filter((k) => k.kind === kind).map((k) => k.id);
  const logIds = idsOf("log");
  const commentIds = idsOf("comment");
  const logs = new Map(
    (logIds.length
      ? db.select().from(activityLogs).where(inArray(activityLogs.id, logIds)).all()
      : []
    ).map((row) => [row.id, toItem(row)]),
  );
  const comments = new Map(
    (commentIds.length
      ? db.select().from(recordComments).where(inArray(recordComments.id, commentIds)).all()
      : []
    ).map((row) => [row.id, toComment(row)]),
  );

  const entries: FeedEntry[] = keys.map((k) =>
    k.kind === "log"
      ? { kind: "log", item: logs.get(k.id)! }
      : { kind: "comment", item: comments.get(k.id)! },
  );
  return { entries, total, page, totalPages };
}

/** LIKE pattern (escape character `!`) for a plain substring: `%` and `_` in what the user typed are not wildcards. */
const likeOf = (q: string) => `%${q.toLowerCase().replace(/[!%_]/g, "!$&")}%`;

/**
 * The audit search: a record's name, who did it, and — as the page shows them, in
 * Indonesian — the record type, the action, the field names and the before/after values.
 */
function activitySearch(q: string): SQL | undefined {
  const needle = likeOf(q);
  const labelled = <K extends string>(labels: Record<K, string>) =>
    (Object.keys(labels) as K[]).filter((k) => labels[k].toLowerCase().includes(q.toLowerCase()));
  const entities = labelled(ENTITY_LABELS);
  const actions = labelled(ACTION_LABELS);
  const fields = labelled(FIELD_LABELS);
  // A field without a label is shown under its own key, so only those keys are searched as text.
  const keyList = (keys: string[]) => sql.join(keys.map((k) => sql`${k}`), sql`, `);
  const matchingField = fields.length ? sql`change.key IN (${keyList(fields)})` : sql`0`;
  return or(
    sql`lower(${activityLogs.entityLabel}) LIKE ${needle} ESCAPE '!'`,
    sql`lower(${activityLogs.actorName}) LIKE ${needle} ESCAPE '!'`,
    entities.length ? inArray(activityLogs.entityType, entities as ActivityEntity[]) : undefined,
    actions.length ? inArray(activityLogs.action, actions as ActivityAction[]) : undefined,
    sql`EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(${activityLogs.changes}) THEN ${activityLogs.changes} ELSE '{}' END) AS change
      WHERE ${matchingField}
        OR (change.key NOT IN (${keyList(Object.keys(FIELD_LABELS))}) AND lower(change.key) LIKE ${needle} ESCAPE '!')
        OR lower(json_extract(change.value, '$.from')) LIKE ${needle} ESCAPE '!'
        OR lower(json_extract(change.value, '$.to')) LIKE ${needle} ESCAPE '!'
    )`,
  );
}

/** Log Audit's "Aktivitas record": every log entry, newest first, filtered and paged in SQL. */
export function listActivityPage(opts: {
  entity?: string;
  q?: string;
  page: number;
  pageSize: number;
}) {
  const where = and(
    opts.entity ? eq(activityLogs.entityType, opts.entity as ActivityEntity) : undefined,
    opts.q ? activitySearch(opts.q) : undefined,
  );
  const total = db.select({ n: count() }).from(activityLogs).where(where).get()!.n;
  const { page, totalPages, offset } = pageWindow(total, opts.page, opts.pageSize);
  const rows = db
    .select()
    .from(activityLogs)
    .where(where)
    .orderBy(desc(activityLogs.id))
    .limit(opts.pageSize)
    .offset(offset)
    .all()
    .map(toItem);
  return { rows, total, page, totalPages, pageSize: opts.pageSize };
}
