import { isNull, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// Relative on purpose: drizzle-kit loads this file without the `~` alias.
import { nowIso } from "../lib/dates";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES, COMMENT_ENTITIES } from "../lib/activity-entities";
import { SCOPES } from "../lib/permissions";

export { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES };
export type { ActivityAction, ActivityEntity } from "../lib/activity-entities";

/**
 * ERD v2 conventions (docs/erd-sigula.dbml, ADR-0005):
 * - enums are TEXT + CHECK (not a DB enum type), so the same DDL ports to PostgreSQL;
 * - timestamps are ISO-8601 UTC TEXT filled by the application, never by a DB default;
 * - master data is soft-deleted (`deleted_at`); uniqueness on it applies to live rows only;
 * - history/log tables are never updated or deleted.
 */
const oneOf = (col: AnySQLiteColumn, values: readonly string[]) =>
  sql`${col} IN (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  )})`;

const createdAt = () => text("created_at").notNull().$defaultFn(() => nowIso());
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .$defaultFn(() => nowIso())
    .$onUpdate(() => nowIso());
const deletedAt = () => text("deleted_at");

/** Live rows only — every read of a soft-deletable table goes through this. */
export const alive = (t: { deletedAt: AnySQLiteColumn }) => isNull(t.deletedAt);

const ACTIVE_STATUSES = ["aktif", "inactive"] as const;
const CUSTOMER_TYPES = ["lama", "baru"] as const;
const ORDER_SOURCES = ["seed", "import", "manual"] as const;
const RECIPIENT_KINDS = ["salesman", "supervisor"] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];
export const CHANNELS = ["whatsapp", "email", "sms", "push"] as const;
export type Channel = (typeof CHANNELS)[number];
const RUN_TRIGGERS = ["manual", "scheduled"] as const;
const DELIVERY_STATUSES = ["queued", "sent", "failed", "skipped_no_contact"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
const FOLLOW_UP_OUTCOMES = ["will_order", "not_ordering", "unreachable"] as const;
/** What became of a WhatsApp message a salesman sent us (`inbound_messages`). */
export const INBOUND_OUTCOMES = ["recorded", "unrecognized", "nothing_pending", "unknown_sender"] as const;
export type InboundOutcome = (typeof INBOUND_OUTCOMES)[number];
const REPLY_STATUSES = ["none", "sent", "failed"] as const;

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    /** The salesman this login acts as. Needed by roles whose permissions are `own`/`team` scoped. */
    salesmanId: integer("salesman_id").references((): AnySQLiteColumn => salesmen.id),
    /** False = cannot sign in, but the account (and its history) stays. Separate from soft delete. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: text("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("users_username_live")
      .on(t.username)
      .where(sql`deleted_at IS NULL`),
    index("users_salesman_idx").on(t.salesmanId),
  ],
);

/**
 * Access control (ADR-0007). A user has roles; a role is a set of permissions, each with
 * a data scope. Permission codes are defined by the application (`app/lib/permissions.ts`)
 * and seeded by migration; admins only choose roles for users.
 */
export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Built-in role: cannot be deleted. */
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const permissions = sqliteTable("permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  description: text("description").notNull().default(""),
});

/** What a role may do, and over whose data: `own` (the user's salesman), `team` (subordinates), `all`. */
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: SCOPES }).notNull().default("all"),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    check("role_permissions_scope_check", oneOf(t.scope, SCOPES)),
  ],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedAt: text("granted_at")
      .notNull()
      .$defaultFn(() => nowIso()),
    grantedById: integer("granted_by_id").references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId),
  ],
);

/**
 * ADR-0004: a supervisor is just a salesman with subordinates.
 * `supervisorId` points at another salesman (salesman 1—N salesman), any
 * depth; cycles are rejected in `masterdata.server.ts`, self-reference here.
 */
export const salesmen = sqliteTable(
  "salesmen",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nama: text("nama").notNull(),
    supervisorId: integer("supervisor_id").references(
      (): AnySQLiteColumn => salesmen.id,
    ),
    status: text("status", { enum: ACTIVE_STATUSES }).notNull().default("aktif"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check("salesmen_status_check", oneOf(t.status, ACTIVE_STATUSES)),
    check(
      "salesman_not_own_supervisor",
      sql`${t.supervisorId} IS NULL OR ${t.supervisorId} <> ${t.id}`,
    ),
    index("salesmen_supervisor_idx").on(t.supervisorId),
  ],
);

/**
 * How to reach a salesman, per channel (ERD D8). Only WhatsApp has a sender and a
 * form today; the other channels are stored, not used. At most one live primary
 * contact per (salesman, channel).
 */
export const salesmanContacts = sqliteTable(
  "salesman_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /** E.164-ish number (`628…`), an email address, or a device token. */
    address: text("address").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check("salesman_contacts_channel_check", oneOf(t.channel, CHANNELS)),
    index("salesman_contacts_salesman_idx").on(t.salesmanId, t.channel),
    uniqueIndex("salesman_contacts_primary_live")
      .on(t.salesmanId, t.channel)
      .where(sql`is_primary = 1 AND deleted_at IS NULL`),
  ],
);

export const customers = sqliteTable(
  "customers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nama: text("nama").notNull(),
    /** CACHE of the open `customer_assignments` row — written in the same transaction. */
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    tipeCustomer: text("tipe_customer", { enum: CUSTOMER_TYPES }).notNull(),
    orderCycleDays: integer("order_cycle_days").notNull().default(30),
    statusCustomer: text("status_customer", { enum: ACTIVE_STATUSES })
      .notNull()
      .default("aktif"),
    /** CACHE of MAX(transaksi.tanggal_order) over live rows. */
    lastOrderDate: text("last_order_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check("customers_tipe_check", oneOf(t.tipeCustomer, CUSTOMER_TYPES)),
    check("customers_status_check", oneOf(t.statusCustomer, ACTIVE_STATUSES)),
    check("order_cycle_days_min", sql`${t.orderCycleDays} >= 1`),
    // The real index is on `lower(nama)` (names differ only by case are the
    // same customer). drizzle-kit cannot express an expression index on SQLite
    // (it renders it as a quoted column name), so migration 0001 creates it by
    // hand and this declares the plain shape; `tests/migrations.test.ts`
    // guards the case-insensitive behaviour.
    uniqueIndex("customers_nama_salesman_live")
      .on(t.nama, t.salesmanId)
      .where(sql`deleted_at IS NULL`),
    index("customers_salesman_idx").on(t.salesmanId),
    index("customers_due_idx").on(t.statusCustomer, t.lastOrderDate),
  ],
);

/**
 * Who held a customer, and when (D7). Immutable except that `valid_to` is set
 * once when the customer moves on. Exactly one open row per customer.
 */
export const customerAssignments = sqliteTable(
  "customer_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    assignedById: integer("assigned_by_id").references(() => users.id),
    note: text("note").notNull().default(""),
  },
  (t) => [
    check(
      "customer_assignments_range",
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
    uniqueIndex("customer_assignments_open")
      .on(t.customerId)
      .where(sql`valid_to IS NULL`),
    index("customer_assignments_customer_idx").on(t.customerId, t.validFrom),
    index("customer_assignments_salesman_idx").on(t.salesmanId),
  ],
);

/** One Excel import: where a group of `transaksi` rows came from. */
export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  importedById: integer("imported_by_id")
    .notNull()
    .references(() => users.id),
  importedAt: text("imported_at")
    .notNull()
    .$defaultFn(() => nowIso()),
});

export const transaksi = sqliteTable(
  "transaksi",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Snapshot: the customer's holder when the order was recorded. */
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    tanggalOrder: text("tanggal_order").notNull(),
    sumber: text("sumber", { enum: ORDER_SOURCES }).notNull(),
    importBatchId: integer("import_batch_id").references(() => importBatches.id),
    catatan: text("catatan").notNull().default(""),
    createdAt: createdAt(),
    createdById: integer("created_by_id").references(() => users.id),
    updatedAt: updatedAt(),
    updatedById: integer("updated_by_id").references(() => users.id),
    deletedAt: deletedAt(),
    deletedById: integer("deleted_by_id").references(() => users.id),
    /** Set when the row went to the trash *because* this customer did (restoring the customer brings it back). */
    deletedWithCustomerId: integer("deleted_with_customer_id").references(() => customers.id),
  },
  (t) => [
    check("transaksi_sumber_check", oneOf(t.sumber, ORDER_SOURCES)),
    index("transaksi_customer_date_idx").on(t.customerId, t.tanggalOrder),
    index("transaksi_salesman_date_idx").on(t.salesmanId, t.tanggalOrder),
  ],
); // DEBT-009: editable/deletable — soft delete + activity_logs restore BR-10's "nothing is lost"

/** Why a customer did not reorder — a lookup admins can extend without a migration. */
export const followUpReasons = sqliteTable("follow_up_reasons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stable code the UI posts (`1`, `2`, `3` for the original three). */
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  /** Choosing this reason marks the customer inactive (e.g. "Sudah Bangkrut"). */
  deactivatesCustomer: integer("deactivates_customer", { mode: "boolean" })
    .notNull()
    .default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/**
 * What a salesman did about an overdue customer. Replaces `reason_logs` and
 * `customers.handled_on`. Immutable. `notification_item_id` links the follow-up
 * to the reminder that prompted it, which is what ends that reminder's "pending".
 */
export const followUps = sqliteTable(
  "follow_ups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    notificationItemId: integer("notification_item_id").references(
      (): AnySQLiteColumn => notificationItems.id,
    ),
    outcome: text("outcome", { enum: FOLLOW_UP_OUTCOMES }).notNull(),
    reasonId: integer("reason_id").references(() => followUpReasons.id),
    note: text("note").notNull().default(""),
    followUpDate: text("follow_up_date").notNull(),
    createdAt: createdAt(),
    createdById: integer("created_by_id").references(() => users.id),
  },
  (t) => [
    check("follow_ups_outcome_check", oneOf(t.outcome, FOLLOW_UP_OUTCOMES)),
    check(
      "follow_ups_reason_required",
      sql`${t.outcome} <> 'not_ordering' OR ${t.reasonId} IS NOT NULL`,
    ),
    index("follow_ups_customer_idx").on(t.customerId, t.followUpDate),
    uniqueIndex("follow_ups_item_unique").on(t.notificationItemId),
  ],
);

/**
 * Message text per code + channel, versioned: editing inserts a new version and
 * retires the old one, so a delivery keeps pointing at the text it really sent.
 */
export const messageTemplates = sqliteTable(
  "message_templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** `reminder_salesman` | `reminder_supervisor`. */
    code: text("code").notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    recipientKind: text("recipient_kind", { enum: RECIPIENT_KINDS }).notNull(),
    /** Email only; empty for chat channels. */
    subject: text("subject").notNull().default(""),
    /** Text with `{{nama}}`, `{{jumlah}}`, `{{daftar_customer}}` placeholders. */
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    createdById: integer("created_by_id").references(() => users.id),
  },
  (t) => [
    check("templates_channel_check", oneOf(t.channel, CHANNELS)),
    check("templates_kind_check", oneOf(t.recipientKind, RECIPIENT_KINDS)),
    uniqueIndex("message_templates_version").on(t.code, t.channel, t.version),
    uniqueIndex("message_templates_active")
      .on(t.code, t.channel)
      .where(sql`is_active = 1`),
  ],
);

/**
 * One trigger of the reminder job. Replaces `notification_batches`. Immutable
 * except `finished_at` and voiding: a voided run stays on record but its
 * reminders stop counting as pending, so those customers can be sent again.
 */
export const notificationRuns = sqliteTable(
  "notification_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trigger: text("trigger", { enum: RUN_TRIGGERS }).notNull(),
    /** Null when the scheduler started it. */
    triggeredById: integer("triggered_by_id").references(() => users.id),
    /** Business date used to decide who is overdue. */
    asOfDate: text("as_of_date").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    voidedAt: text("voided_at"),
    voidedById: integer("voided_by_id").references(() => users.id),
    voidReason: text("void_reason").notNull().default(""),
  },
  (t) => [
    check("runs_trigger_check", oneOf(t.trigger, RUN_TRIGGERS)),
    check(
      "runs_manual_has_actor",
      sql`${t.trigger} <> 'manual' OR ${t.triggeredById} IS NOT NULL`,
    ),
  ],
);

/** One message to one recipient on one channel. A retry is a new row (`attempt` + 1). */
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => notificationRuns.id),
    // The recipient salesman; `recipientKind` says which message they got
    // (their own overdue customers vs. a summary of their direct reports).
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    recipientKind: text("recipient_kind", { enum: RECIPIENT_KINDS })
      .notNull()
      .default("salesman"),
    channel: text("channel", { enum: CHANNELS }).notNull().default("whatsapp"),
    contactId: integer("contact_id").references(() => salesmanContacts.id),
    /** Snapshot of where it went — the contact may change later. */
    address: text("address").notNull().default(""),
    templateId: integer("template_id").references(() => messageTemplates.id),
    /** Snapshot of the final text that was sent. */
    messageBody: text("message_body").notNull().default(""),
    /** Snapshot of how many customers the message covers (also for pre-R3 rows that have no items). */
    customerCount: integer("customer_count").notNull().default(0),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull(),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message").notNull().default(""),
    attempt: integer("attempt").notNull().default(1),
    sentAt: text("sent_at"),
  },
  (t) => [
    check("deliveries_kind_check", oneOf(t.recipientKind, RECIPIENT_KINDS)),
    check("deliveries_channel_check", oneOf(t.channel, CHANNELS)),
    check("deliveries_status_check", oneOf(t.status, DELIVERY_STATUSES)),
    index("deliveries_run_idx").on(t.runId),
    index("deliveries_salesman_idx").on(t.salesmanId, t.sentAt),
  ],
);

/**
 * Which customers a message covered. A customer is "pending" (reminded, waiting
 * for the salesman) while it has an item on a sent salesman message of a live
 * run that has no follow-up and no newer order — see `pending.server.ts`.
 */
export const notificationItems = sqliteTable(
  "notification_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Snapshot: the last order date when the message was made (null = never ordered). */
    lastOrderDate: text("last_order_date"),
    /** Snapshot: days past the customer's cycle (0 when never ordered). */
    daysOverdue: integer("days_overdue").notNull(),
    /** The line number this customer had in the message ("3. TOKO A — …"); a reply's "3" means this row. Null for messages sent before replies were read. */
    position: integer("position"),
  },
  (t) => [
    uniqueIndex("notification_items_delivery_customer").on(t.deliveryId, t.customerId),
    index("notification_items_customer_idx").on(t.customerId),
  ],
);

/**
 * A WhatsApp message that reached the WAHA webhook (ADR-0009): a salesman answering a
 * reminder. One row per WhatsApp message id — WAHA retries a webhook it thinks failed, and
 * the unique id is what makes a retry a no-op. Kept even when nothing was recorded, so an
 * admin can see why a reply did not count. `replyText` is what we answered (or tried to).
 */
export const inboundMessages = sqliteTable(
  "inbound_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerMessageId: text("provider_message_id").notNull(),
    session: text("session").notNull().default(""),
    /** The sender's number, digits only. */
    fromAddress: text("from_address").notNull(),
    /** Set when the number is a salesman's contact. */
    salesmanId: integer("salesman_id").references(() => salesmen.id),
    body: text("body").notNull().default(""),
    /** The id of the message this one quoted ("replied to"), "" when none. Kept as WAHA sent it, to see why a quote did or did not match a reminder. */
    replyTo: text("reply_to").notNull().default(""),
    outcome: text("outcome", { enum: INBOUND_OUTCOMES }).notNull(),
    /** Human-readable summary of what was done ("2 customer dicatat"). */
    detail: text("detail").notNull().default(""),
    replyText: text("reply_text").notNull().default(""),
    replyStatus: text("reply_status", { enum: REPLY_STATUSES }).notNull().default("none"),
    /** When the salesman sent it (from WhatsApp), ISO-8601 UTC. */
    receivedAt: text("received_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("inbound_outcome_check", oneOf(t.outcome, INBOUND_OUTCOMES)),
    check("inbound_reply_status_check", oneOf(t.replyStatus, REPLY_STATUSES)),
    uniqueIndex("inbound_messages_provider_id").on(t.providerMessageId),
    index("inbound_messages_salesman_idx").on(t.salesmanId, t.id),
  ],
);

/** Active/inactive transitions of a customer. Replaces `status_logs`. Immutable. */
export const customerStatusHistory = sqliteTable(
  "customer_status_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    fromStatus: text("from_status", { enum: ACTIVE_STATUSES }).notNull(),
    toStatus: text("to_status", { enum: ACTIVE_STATUSES }).notNull(),
    /** `manual_inactive` | `manual_reactivation` | `auto_reactivation` (free text by design). */
    reason: text("reason").notNull().default(""),
    /** Null = done by the system. */
    changedById: integer("changed_by_id").references(() => users.id),
    changedAt: text("changed_at")
      .notNull()
      .$defaultFn(() => nowIso()),
  },
  (t) => [
    check("status_history_from_check", oneOf(t.fromStatus, ACTIVE_STATUSES)),
    check("status_history_to_check", oneOf(t.toStatus, ACTIVE_STATUSES)),
    index("status_history_customer_idx").on(t.customerId, t.changedAt),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  /** True for values that must never be shown or logged whole (API keys). */
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
  updatedAt: updatedAt(),
  updatedById: integer("updated_by_id").references(() => users.id),
});


/**
 * Per-record audit trail. `entityLabel` and `actorName` are snapshots so the
 * trail stays readable after the record or the user is deleted; `changes` is
 * JSON `{ [field]: { from, to } }` (never contains secrets). `entity_type` is
 * free text in the database (no CHECK) so a new audited table needs no migration.
 */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type", { enum: ACTIVITY_ENTITIES }).notNull(),
    entityId: integer("entity_id").notNull(),
    entityLabel: text("entity_label").notNull().default(""),
    action: text("action", { enum: ACTIVITY_ACTIONS }).notNull(),
    actorId: integer("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull().default(""),
    changes: text("changes").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("activity_action_check", oneOf(t.action, ACTIVITY_ACTIONS)),
    index("activity_entity_idx").on(t.entityType, t.entityId, t.id),
    index("activity_actor_idx").on(t.actorId, t.createdAt),
  ],
);

/**
 * Messages people leave on a record's panel (design system: "Activity & comments"),
 * next to the automatic activity log. `authorName` is a snapshot, like the log's
 * `actorName`. A comment is never edited or deleted here.
 */
export const recordComments = sqliteTable(
  "record_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type", { enum: COMMENT_ENTITIES }).notNull(),
    entityId: integer("entity_id").notNull(),
    body: text("body").notNull(),
    authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("record_comments_body_check", sql`length(trim(${t.body})) > 0`),
    index("record_comments_entity_idx").on(t.entityType, t.entityId, t.id),
  ],
);

