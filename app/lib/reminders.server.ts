import { and, count, desc, eq, gt, inArray, like } from "drizzle-orm";

import { db } from "~/db/client.server";
import {
  activityLogs,
  notificationDeliveries,
  notificationItems,
  notificationRuns,
  salesmen,
  type Channel,
  type RecipientKind,
} from "~/db/schema";
import { logActivity } from "~/lib/activity.server";
import { attachWhatsapp, primaryContact, whatsappNumber } from "~/lib/contacts.server";
import { daysSinceOrder, formatDateShort, isOverdue, nowIso, todayIso } from "~/lib/dates";
import { listFollowUpReasons } from "~/lib/follow-ups.server";
import { directReportIds, findLiveCustomer, findLiveSalesman } from "~/lib/masterdata.server";
import { notYetNotifiedEligible } from "~/lib/orders.server";
import { pageWindow } from "~/lib/pagination";
import { activeTemplate, customerLines, orderByWait, renderTemplate, type TemplateCode } from "~/lib/templates.server";
import { createWahaClient, type WahaClient } from "~/lib/waha.server";
import { isPlausibleWhatsappNumber, normalizeWhatsappNumber } from "~/lib/whatsapp-number";

/**
 * The reminder job (FR-3, ADR-0002, ADR-0006). A *run* is one trigger; it holds
 * one *delivery* per recipient and channel; each delivery lists the customers
 * it covered as *items*. Who is still "pending" is derived from those rows
 * (`pending.server.ts`) — nothing here flips a flag. Runs are a log: they are
 * voided, never deleted.
 */

/** Channels that have a sender. Adding a channel means adding its sender in `deliver`. DEBT-014: WhatsApp only. */
const ACTIVE_CHANNELS = ["whatsapp"] as const;
type ActiveChannel = (typeof ACTIVE_CHANNELS)[number];
const isActiveChannel = (c: Channel): c is ActiveChannel =>
  (ACTIVE_CHANNELS as readonly Channel[]).includes(c);

type Eligible = ReturnType<typeof notYetNotifiedEligible>[number];
type Delivery = typeof notificationDeliveries.$inferSelect;

const TEMPLATE_FOR: Record<RecipientKind, TemplateCode> = {
  salesman: "reminder_salesman",
  supervisor: "reminder_supervisor",
};

/** The newest attempt per recipient, kind and channel — where a run currently stands. */
function latestAttempts(deliveries: Delivery[]): Delivery[] {
  const latest = new Map<string, Delivery>();
  for (const d of [...deliveries].sort((a, b) => a.attempt - b.attempt || a.id - b.id)) {
    latest.set(`${d.salesmanId}:${d.recipientKind}:${d.channel}`, d);
  }
  return [...latest.values()];
}

export function eligibleCustomerCount(today = todayIso()) {
  return notYetNotifiedEligible(today).length;
}

const salesmenWithWhatsapp = (ids: number[]) =>
  ids.length === 0
    ? []
    : attachWhatsapp(db.select().from(salesmen).where(inArray(salesmen.id, ids)).all());

export function previewBatch(today = todayIso()) {
  const eligible = notYetNotifiedEligible(today);
  const bySalesman = new Map<number, Eligible[]>();
  for (const c of eligible) {
    const list = bySalesman.get(c.salesmanId) ?? [];
    list.push(c);
    bySalesman.set(c.salesmanId, list);
  }

  const salesmanById = new Map(salesmenWithWhatsapp([...bySalesman.keys()]).map((s) => [s.id, s]));
  const salesmanRows = [...bySalesman.keys()].map((id) => ({
    salesman: salesmanById.get(id)!,
    customers: bySalesman.get(id)!,
  }));

  // ADR-0004: a supervisor is a salesman; the summary goes to the *direct*
  // supervisor only and covers that supervisor's direct reports.
  const supervisorIds = [
    ...new Set(
      salesmanRows.map((s) => s.salesman.supervisorId).filter((id): id is number => id != null),
    ),
  ];
  const supervisorById = new Map(salesmenWithWhatsapp(supervisorIds).map((s) => [s.id, s]));
  const supervisorRows = supervisorIds.map((id) => ({
    supervisor: supervisorById.get(id)!,
    customers: eligible.filter((c) => salesmanById.get(c.salesmanId)?.supervisorId === id),
  }));

  return { salesmen: salesmanRows, supervisors: supervisorRows };
}

/**
 * Starts a run for everyone who is overdue and not already pending; `null`
 * (and nothing written) when nobody is. `triggeredById` null = the scheduler.
 * A recipient with no contact for the channel gets a `skipped_no_contact`
 * delivery (FR-17); a failed send is recorded, never thrown (FR-29).
 */
export async function triggerBatch(opts: {
  triggeredById: number | null;
  client?: WahaClient;
  today?: string;
}) {
  const today = opts.today ?? todayIso();
  const client = opts.client ?? createWahaClient();
  const preview = previewBatch(today);
  if (preview.salesmen.length === 0) return null;
  // Missing reference data must fail before anything is written.
  for (const channel of ACTIVE_CHANNELS) {
    for (const code of Object.values(TEMPLATE_FOR)) activeTemplate(code, channel);
  }

  const run = db
    .insert(notificationRuns)
    .values({
      trigger: opts.triggeredById == null ? "scheduled" : "manual",
      triggeredById: opts.triggeredById,
      asOfDate: today,
      startedAt: nowIso(),
    })
    .returning()
    .get();

  for (const channel of ACTIVE_CHANNELS) {
    for (const row of preview.salesmen) {
      await deliver({ client, runId: run.id, kind: "salesman", recipient: row.salesman, list: row.customers, channel, attempt: 1, today });
    }
    for (const row of preview.supervisors) {
      await deliver({ client, runId: run.id, kind: "supervisor", recipient: row.supervisor, list: row.customers, channel, attempt: 1, today });
    }
  }

  db.update(notificationRuns).set({ finishedAt: nowIso() }).where(eq(notificationRuns.id, run.id)).run();
  return db.select().from(notificationRuns).where(eq(notificationRuns.id, run.id)).get()!;
}

/** A customer is not reminded again within this many minutes of its last reminder (a double click, a second admin). */
export const RESEND_COOLDOWN_MINUTES = 10;

/**
 * Admin's "Kirim pengingat kembali": one more reminder for one overdue customer, sent to
 * its salesman right now — the same message as a batch (a list of one). It is an explicit
 * action of an Admin, so ADR-0002 holds. Refused, before anything is written, for a customer
 * that is inactive or not overdue, whose salesman has no WhatsApp number, or that was reminded
 * a moment ago. It is a run of its own (visible on the dashboard); if the message cannot be
 * sent that run is voided, so the dashboard does not offer a retry that would skip this
 * customer (a retry only takes customers not yet reminded) — sending again is this action.
 * A sent one is written to the customer's activity. Throws a readable `Error`.
 */
export async function resendReminder(opts: {
  customerId: number;
  triggeredById: number;
  client?: WahaClient;
  today?: string;
  now?: Date;
}) {
  const today = opts.today ?? todayIso();
  const now = opts.now ?? new Date();
  const customer = findLiveCustomer(opts.customerId);
  if (!customer) throw new Error("Customer tidak ditemukan");
  if (customer.statusCustomer !== "aktif") throw new Error("Customer inactive tidak diingatkan");
  if (!isOverdue(customer.lastOrderDate, customer.orderCycleDays, today)) throw new Error("Customer belum overdue");
  const salesman = salesmenWithWhatsapp([customer.salesmanId])[0];
  if (!salesman) throw new Error("Salesman tidak ditemukan");
  if (!salesman.nomorWa) throw new Error(`${salesman.nama} belum punya nomor WhatsApp`);
  if (!isPlausibleWhatsappNumber(normalizeWhatsappNumber(salesman.nomorWa))) {
    throw new Error(`Nomor WhatsApp ${salesman.nama} tidak valid (${salesman.nomorWa}) — perbaiki di Data Master → Salesman`);
  }

  const recent = db
    .select({ sentAt: notificationDeliveries.sentAt })
    .from(notificationItems)
    .innerJoin(notificationDeliveries, eq(notificationDeliveries.id, notificationItems.deliveryId))
    .where(
      and(
        eq(notificationItems.customerId, customer.id),
        eq(notificationDeliveries.recipientKind, "salesman"),
        eq(notificationDeliveries.status, "sent"),
        gt(notificationDeliveries.sentAt, nowIso(new Date(now.getTime() - RESEND_COOLDOWN_MINUTES * 60_000))),
      ),
    )
    .get();
  if (recent) throw new Error(`Customer ini baru saja diingatkan — tunggu ${RESEND_COOLDOWN_MINUTES} menit sebelum mengirim lagi`);

  activeTemplate(TEMPLATE_FOR.salesman, "whatsapp"); // missing reference data must fail before anything is written
  const run = db
    .insert(notificationRuns)
    .values({ trigger: "manual", triggeredById: opts.triggeredById, asOfDate: today, startedAt: nowIso() })
    .returning()
    .get();
  await deliver({
    client: opts.client ?? createWahaClient(),
    runId: run.id,
    kind: "salesman",
    recipient: salesman,
    list: [customer],
    channel: "whatsapp",
    attempt: 1,
    today,
  });
  db.update(notificationRuns).set({ finishedAt: nowIso() }).where(eq(notificationRuns.id, run.id)).run();

  const delivery = db.select().from(notificationDeliveries).where(eq(notificationDeliveries.runId, run.id)).get()!;
  if (delivery.status !== "sent") {
    const why = delivery.errorMessage || "pesan tidak terkirim";
    voidBatch({ batchId: run.id, voidedById: opts.triggeredById, reason: `Kirim ulang gagal: ${why}` });
    throw new Error(`Pengingat gagal dikirim ke ${salesman.nama}: ${why}`);
  }
  logActivity({
    entityType: "customer",
    entityId: customer.id,
    entityLabel: customer.nama,
    action: "update",
    actorId: opts.triggeredById,
    changes: { pengingat_dikirim: { from: null, to: `${salesman.nama} (WhatsApp)` } },
  });
  return { runId: run.id, salesmanName: salesman.nama };
}

/** The same salesman is not sent a test message again within this many seconds (a double click). */
export const TEST_MESSAGE_COOLDOWN_SECONDS = 60;

/** The test message: no template on purpose — it is not a reminder, and must never look like one. */
const testMessageText = (nama: string) =>
  `🔔 Pesan tes SiGula\n\nHalo ${nama}, ini pesan tes dari SiGula. Jika Anda membacanya, pengingat akan sampai ke nomor WhatsApp ini. Tidak perlu dibalas.`;

/**
 * Admin's "Kirim pesan tes" on a salesman: one short message to the salesman's WhatsApp number,
 * to find out whether reminders reach that number at all — WhatsApp refuses some numbers (not on
 * WhatsApp) and some senders (a restricted account), and the reminder run only shows that after
 * the fact. It is not a reminder: no run, no delivery, nothing that changes who is pending.
 * A sent one is written to the salesman's activity. Throws a readable `Error`, with WhatsApp's
 * reason when the message was refused.
 */
export async function sendTestMessage(opts: {
  salesmanId: number;
  sentById: number;
  client?: WahaClient;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const salesman = findLiveSalesman(opts.salesmanId);
  if (!salesman) throw new Error("Salesman tidak ditemukan");
  const number = whatsappNumber(salesman.id);
  if (!number) throw new Error(`${salesman.nama} belum punya nomor WhatsApp`);
  if (!isPlausibleWhatsappNumber(normalizeWhatsappNumber(number))) {
    throw new Error(`Nomor WhatsApp ${salesman.nama} tidak valid (${number}) — perbaiki di Data Master → Salesman`);
  }

  const recent = db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.entityType, "salesman"),
        eq(activityLogs.entityId, salesman.id),
        like(activityLogs.changes, '%"pesan_tes_dikirim"%'),
        gt(activityLogs.createdAt, nowIso(new Date(now.getTime() - TEST_MESSAGE_COOLDOWN_SECONDS * 1000))),
      ),
    )
    .get();
  if (recent) {
    throw new Error(`Pesan tes baru saja dikirim ke ${salesman.nama} — tunggu ${TEST_MESSAGE_COOLDOWN_SECONDS} detik sebelum mengirim lagi`);
  }

  const result = await (opts.client ?? createWahaClient()).sendText(number, testMessageText(salesman.nama));
  if (!result.ok) {
    throw new Error(`Pesan tes gagal dikirim ke ${salesman.nama}: ${result.errorMessage || "pesan tidak terkirim"}`);
  }
  logActivity({
    entityType: "salesman",
    entityId: salesman.id,
    entityLabel: salesman.nama,
    action: "update",
    actorId: opts.sentById,
    changes: { pesan_tes_dikirim: { from: null, to: `${number} (WhatsApp)` } },
  });
  return { salesmanName: salesman.nama, number };
}

/**
 * Sends again every delivery of the run whose latest attempt failed, as a *new*
 * delivery (attempt + 1) — the failed row stays as the record of what went
 * wrong. The lists are recomputed: whoever was followed up or ordered in the
 * meantime is dropped, and a delivery left with nobody is not retried.
 */
export async function retryBatch(opts: { batchId: number; client?: WahaClient; today?: string }) {
  const today = opts.today ?? todayIso();
  const client = opts.client ?? createWahaClient();
  const run = db.select().from(notificationRuns).where(eq(notificationRuns.id, opts.batchId)).get();
  if (!run) throw new Error("Pengiriman tidak ditemukan");
  if (run.voidedAt) throw new Error("Pengiriman sudah dibatalkan");

  // One snapshot for the whole retry, so a summary counts the customers a
  // salesman message retried a moment earlier in this same pass.
  const eligible = notYetNotifiedEligible(today);
  const deliveries = db.select().from(notificationDeliveries).where(eq(notificationDeliveries.runId, run.id)).all();
  for (const d of latestAttempts(deliveries)) {
    if (d.status !== "failed" || !isActiveChannel(d.channel)) continue;
    const recipient = salesmenWithWhatsapp([d.salesmanId])[0];
    if (!recipient) continue;
    const team = d.recipientKind === "supervisor" ? new Set(directReportIds(recipient.id)) : null;
    const list = eligible.filter((c) => (team ? team.has(c.salesmanId) : c.salesmanId === recipient.id));
    if (list.length === 0) continue;
    await deliver({ client, runId: run.id, kind: d.recipientKind, recipient, list, channel: d.channel, attempt: d.attempt + 1, today });
  }
  return db.select().from(notificationRuns).where(eq(notificationRuns.id, run.id)).get()!;
}

/**
 * Cancels a run that delivered nothing (every message failed or was skipped), so it
 * is no longer retried. It stays on record. A message that was sent cannot be taken
 * back, so a run with any sent delivery is refused — the dashboard hides its button
 * too, but a stale page can still post here. (Runs voided before this rule keep
 * their effect: their reminders do not count as pending, see `pending.server.ts`.)
 */
export function voidBatch(opts: { batchId: number; voidedById: number; reason?: string }) {
  const run = db.select().from(notificationRuns).where(eq(notificationRuns.id, opts.batchId)).get();
  if (!run) throw new Error("Pengiriman tidak ditemukan");
  if (run.voidedAt) throw new Error("Pengiriman sudah dibatalkan");
  const delivered = db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.runId, run.id), eq(notificationDeliveries.status, "sent")))
    .get();
  if (delivered) throw new Error("Pengiriman sudah terkirim — tidak bisa dibatalkan");
  db.update(notificationRuns)
    .set({ voidedAt: nowIso(), voidedById: opts.voidedById, voidReason: (opts.reason ?? "").trim() })
    .where(eq(notificationRuns.id, run.id))
    .run();
}

export const RUNS_PAGE_SIZE = 5;

/**
 * One page of runs, newest first, with their deliveries and recipient names — the
 * dashboard's history. `needsRetry`: some recipient's latest attempt failed. A stale
 * `requestedPage` is clamped (see `pageWindow`), so `page` is the one actually shown.
 */
export function runsPage(requestedPage = 1, pageSize = RUNS_PAGE_SIZE) {
  const total = db.select({ n: count() }).from(notificationRuns).get()!.n;
  const { page, totalPages, offset } = pageWindow(total, requestedPage, pageSize);
  const rows = db
    .select()
    .from(notificationRuns)
    .orderBy(desc(notificationRuns.id))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map((run) => {
      const deliveries = db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.runId, run.id))
        .orderBy(notificationDeliveries.id)
        .all();
      const ids = [...new Set(deliveries.map((d) => d.salesmanId))];
      const names = new Map(
        ids.length === 0
          ? []
          : db
              .select({ id: salesmen.id, nama: salesmen.nama })
              .from(salesmen)
              .where(inArray(salesmen.id, ids))
              .all()
              .map((s) => [s.id, s.nama]),
      );
      return {
        ...run,
        needsRetry: latestAttempts(deliveries).some((d) => d.status === "failed"),
        deliveries: deliveries.map((d) => ({ ...d, name: names.get(d.salesmanId) ?? "?" })),
      };
    });
  return { rows, total, page, totalPages, pageSize };
}

async function deliver(opts: {
  client: WahaClient;
  runId: number;
  kind: RecipientKind;
  recipient: { id: number; nama: string };
  list: Eligible[];
  channel: ActiveChannel;
  attempt: number;
  today: string;
}) {
  const { recipient, channel, kind, list } = opts;
  const base = {
    runId: opts.runId,
    salesmanId: recipient.id,
    recipientKind: kind,
    channel,
    customerCount: list.length,
    attempt: opts.attempt,
  };

  const contact = primaryContact(recipient.id, channel);
  if (!contact) {
    db.insert(notificationDeliveries).values({ ...base, status: "skipped_no_contact" }).run();
    return;
  }
  if (channel === "whatsapp" && !isPlausibleWhatsappNumber(normalizeWhatsappNumber(contact.address))) {
    // Garbage in the number field: skip it with the reason instead of asking WAHA and getting a 500.
    db.insert(notificationDeliveries)
      .values({ ...base, contactId: contact.id, address: contact.address, status: "skipped_no_contact", errorMessage: `Nomor WhatsApp tidak valid: ${contact.address}` })
      .run();
    return;
  }

  const template = activeTemplate(TEMPLATE_FOR[kind], channel);
  const body = renderTemplate(template.body, {
    nama: recipient.nama,
    jumlah: list.length,
    tanggal: formatDateShort(opts.today),
    daftar_customer: customerLines(list, opts.today),
    daftar_alasan: listFollowUpReasons().map((r) => r.label).join(" / "),
  });

  // Written as `queued` before sending, so a crash mid-send leaves a trace.
  const delivery = db.transaction((tx) => {
    const row = tx
      .insert(notificationDeliveries)
      .values({
        ...base,
        contactId: contact.id,
        address: contact.address,
        templateId: template.id,
        messageBody: body,
        status: "queued",
      })
      .returning()
      .get();
    tx.insert(notificationItems)
      .values(
        orderByWait(list, opts.today).map((c, i) => ({
          deliveryId: row.id,
          customerId: c.id,
          position: i + 1,
          lastOrderDate: c.lastOrderDate,
          daysOverdue: c.lastOrderDate
            ? Math.max(0, (daysSinceOrder(c.lastOrderDate, opts.today) ?? 0) - c.orderCycleDays)
            : 0,
        })),
      )
      .run();
    return row;
  });

  const result = await opts.client.sendText(contact.address, body);
  db.update(notificationDeliveries)
    .set({
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.messageId ?? null,
      errorMessage: result.errorMessage ?? "",
      sentAt: result.ok ? nowIso() : null,
    })
    .where(eq(notificationDeliveries.id, delivery.id))
    .run();
}
