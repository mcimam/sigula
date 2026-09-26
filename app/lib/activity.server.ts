import { and, desc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  activityLogs,
  users,
  type ActivityAction,
  type ActivityEntity,
} from "~/db/schema";
import type { ActivityItem, Changes, FieldChange } from "~/lib/activity-format";

type Value = string | number | null | undefined;

function stamp() {
  // Explicit value — Drizzle+SQLite mishandles sql`(datetime('now'))` defaults
  // on INSERT (see reminders.server.ts), and this keeps tests deterministic-ish.
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

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
  const actorName = actorId
    ? (db.select({ n: users.displayName }).from(users).where(eq(users.id, actorId)).get()
        ?.n ?? "")
    : "";
  db.insert(activityLogs)
    .values({
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
      action: opts.action,
      actorId,
      actorName,
      changes: JSON.stringify(opts.changes ?? {}),
      createdAt: stamp(),
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

export function listActivityFor(
  entityType: ActivityEntity,
  entityId: number,
  limit = 30,
): ActivityItem[] {
  return db
    .select()
    .from(activityLogs)
    .where(
      and(eq(activityLogs.entityType, entityType), eq(activityLogs.entityId, entityId)),
    )
    .orderBy(desc(activityLogs.id))
    .limit(limit)
    .all()
    .map(toItem);
}

export function listRecentActivity(limit = 1000): ActivityItem[] {
  return db
    .select()
    .from(activityLogs)
    .orderBy(desc(activityLogs.id))
    .limit(limit)
    .all()
    .map(toItem);
}
