import { asc, eq } from "drizzle-orm";

import { createUserSession, getAuthUser, hashPassword } from "~/lib/auth.server";
import { db, sqlite } from "~/db/client.server";
import {
  customerAssignments,
  customers,
  notificationDeliveries,
  notificationItems,
  notificationRuns,
  salesmen,
  users,
} from "~/db/schema";
import type { ActivityEntity } from "~/db/schema";
import { listActivityPage, listFeedFor } from "~/lib/activity.server";
import { setWhatsappNumber } from "~/lib/contacts.server";
import { nowIso } from "~/lib/dates";
import { pendingCustomerIds } from "~/lib/pending.server";
import { insertCustomer } from "~/lib/masterdata.server";
import { roleIdsByCode, setUserRoles } from "~/lib/roles.server";

// Children first (foreign keys are off while wiping, but keep the order honest).
// `follow_up_reasons`, `message_templates` (migration 0003) and `roles`, `permissions`,
// `role_permissions` (0004) are reference data seeded by migration; they are not wiped (see `resetDb`).
const TABLES = [
  "activity_logs",
  "record_comments",
  "inbound_messages",
  "app_settings",
  "follow_ups",
  "notification_items",
  "notification_deliveries",
  "notification_runs",
  "customer_status_history",
  "customer_assignments",
  "transaksi",
  "import_batches",
  "user_roles",
  "salesman_contacts",
  "customers",
  "salesmen",
  "users",
] as const;

/** A request carrying a real session cookie for `userId`. */
export async function requestAs(userId: number) {
  const res = await createUserSession(userId, "/");
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  return new Request("http://localhost/", { headers: { Cookie: cookie } });
}

/** The signed-in user (with permissions) that `userId` would be on a request. */
export const grantsOf = async (userId: number) => (await getAuthUser(await requestAs(userId)))!;

/** A record's log entries, newest first (its comments left out). */
export const logsFor = (entityType: ActivityEntity, entityId: number) =>
  listFeedFor(entityType, entityId, 1, 1000).entries.flatMap((e) => (e.kind === "log" ? [e.item] : []));

/** The latest log entries across all records, newest first. */
export const recentLogs = (limit = 20) => listActivityPage({ page: 1, pageSize: limit }).rows;

let seededTemplates: { id: number; is_active: number }[] | undefined;

/** Wipe all rows (the schema was migrated when the database opened). Call in beforeEach. */
export function resetDb() {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  for (const table of TABLES) {
    try {
      sqlite.exec(`DELETE FROM ${table}`);
    } catch {
      // table may not exist (e.g. order_history after migration)
    }
  }
  // Tests that edit a template leave newer versions behind: back to the seeded versions, and the seeded active flags.
  seededTemplates ??= sqlite.prepare("SELECT id, is_active FROM message_templates").all() as { id: number; is_active: number }[];
  sqlite.exec(`DELETE FROM message_templates WHERE id NOT IN (${seededTemplates.map((t) => t.id).join(",")})`);
  const setActive = sqlite.prepare("UPDATE message_templates SET is_active = ? WHERE id = ?");
  for (const t of seededTemplates) setActive.run(t.is_active, t.id);
  sqlite.exec("PRAGMA foreign_keys = ON");
}

let hashedPassword = "";

export async function seedOrg(opts?: {
  salesmanWa?: string;
  supervisorWa?: string;
}) {

  hashedPassword ||= await hashPassword("sigula123");

  // ADR-0004: a supervisor is a salesman that other salesmen report to.
  const supervisor = db
    .insert(salesmen)
    .values({ nama: "Budi Supervisor", status: "aktif" })
    .returning()
    .get();
  setWhatsappNumber(supervisor.id, opts?.supervisorWa ?? "628111111111");

  const salesman = db
    .insert(salesmen)
    .values({ nama: "Andi Sales", supervisorId: supervisor.id, status: "aktif" })
    .returning()
    .get();
  setWhatsappNumber(salesman.id, opts?.salesmanWa ?? "628222222222");

  const salesmanB = db
    .insert(salesmen)
    .values({ nama: "Citra Sales", supervisorId: supervisor.id, status: "aktif" })
    .returning()
    .get();
  setWhatsappNumber(salesmanB.id, "628333333333");

  const admin = createUser("admin", "Admin", ["admin"]);
  const salesmanUser = createUser("salesman", "Andi", ["salesman"], salesman.id);

  return { supervisor, salesman, salesmanB, admin, salesmanUser };
}

/** A login with the given role codes. Direct inserts: fixtures skip the form-level validation on purpose. */
export function createUser(
  username: string,
  displayName: string,
  roleCodes: string[],
  salesmanId: number | null = null,
) {
  const user = db
    .insert(users)
    .values({ username, passwordHash: hashedPassword, displayName, salesmanId })
    .returning()
    .get();
  setUserRoles(db, user.id, roleIdsByCode(roleCodes), null);
  return user;
}

export function addCustomer(opts: {
  salesmanId: number;
  nama: string;
  lastOrderDate?: string | null;
  orderCycleDays?: number;
  statusCustomer?: "aktif" | "inactive";
  /** Makes the customer "pending": it was reminded and is waiting for its salesman. */
  pending?: boolean;
  tipeCustomer?: "lama" | "baru";
}) {
  const customer = insertCustomer({
    nama: opts.nama,
    salesmanId: opts.salesmanId,
    tipeCustomer: opts.tipeCustomer ?? "lama",
    orderCycleDays: opts.orderCycleDays ?? 30,
    statusCustomer: opts.statusCustomer ?? "aktif",
    lastOrderDate: opts.lastOrderDate === undefined ? "2026-01-01" : opts.lastOrderDate,
  });
  if (opts.pending) markPending(customer.id);
  return customer;
}

/**
 * Gives a customer a sent salesman reminder (a scheduled run, one delivery, one item), which is
 * all "pending" is made of. Built by hand so a test can set the state up without sending anything.
 */
function markPending(customerId: number) {
  const customer = getCustomer(customerId);
  const run = db
    .insert(notificationRuns)
    .values({ trigger: "scheduled", asOfDate: TODAY, startedAt: "2026-09-12T01:00:00Z" })
    .returning()
    .get();
  const delivery = db
    .insert(notificationDeliveries)
    .values({
      runId: run.id,
      salesmanId: customer.salesmanId,
      recipientKind: "salesman",
      channel: "whatsapp",
      status: "sent",
      customerCount: 1,
      sentAt: "2026-09-12T01:00:01Z",
    })
    .returning()
    .get();
  return db
    .insert(notificationItems)
    .values({
      deliveryId: delivery.id,
      customerId: customer.id,
      lastOrderDate: customer.lastOrderDate,
      daysOverdue: 0,
    })
    .returning()
    .get();
}

export function getCustomer(id: number) {
  return db.select().from(customers).where(eq(customers.id, id)).get()!;
}

/** Fixed "today" used across service tests unless overridden. */
export const TODAY = "2026-09-12";

/**
 * Voids a run the way it was done before `voidBatch` began refusing a run that delivered a
 * message: by writing the row. Such runs exist in real data and must keep freeing their
 * customers (`pending.server.ts`), so tests of that go through here.
 */
export function voidRunLegacy(runId: number, byUserId: number) {
  db.update(notificationRuns)
    .set({ voidedAt: nowIso(), voidedById: byUserId })
    .where(eq(notificationRuns.id, runId))
    .run();
}

/** Whether the customer is waiting for its salesman after a reminder (see `pending.server.ts`). */
export const isPending = (customerId: number) => pendingCustomerIds().has(customerId);

/** Every assignment of a customer, oldest first — the who-held-it-when history. */
export function assignmentHistory(customerId: number) {
  return db
    .select()
    .from(customerAssignments)
    .where(eq(customerAssignments.customerId, customerId))
    .orderBy(asc(customerAssignments.validFrom), asc(customerAssignments.id))
    .all();
}
