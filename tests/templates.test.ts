import { beforeEach, describe, expect, it } from "vitest";

import { and, desc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { messageTemplates, notificationDeliveries } from "~/db/schema";
import { triggerBatch } from "~/lib/reminders.server";
import {
  activeTemplate,
  EDITABLE_TEMPLATE_CHANNELS,
  listEditableTemplates,
  renderTemplate,
  SAMPLE_VARS,
  saveTemplateVersion,
  unknownPlaceholders,
  customerLines,
} from "~/lib/templates.server";

import { TODAY, addCustomer, resetDb, seedOrg, logsFor } from "./helpers/fixtures";

/** Every version of a template, newest first. */
const templateHistory = (code: string, channel: "whatsapp" | "email") =>
  db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.code, code), eq(messageTemplates.channel, channel)))
    .orderBy(desc(messageTemplates.version))
    .all();

describe("renderTemplate", () => {
  it("fills every known placeholder, however it is spaced, and leaves unknown ones alone", () => {
    const vars = { ...SAMPLE_VARS, daftar_customer: "Toko A, Toko B" };
    expect(renderTemplate("Halo {{nama}} / {{ jumlah }} / {{daftar_customer}} / {{lain}}", vars)).toBe(
      "Halo Andi / 3 / Toko A, Toko B / {{lain}}",
    );
  });

  it("fills the date and the reasons too, and does not expand a placeholder that appears inside a value", () => {
    const vars = { ...SAMPLE_VARS, nama: "{{jumlah}}", tanggal: "5 Mei 2026", daftar_alasan: "A / B" };
    expect(renderTemplate("[{{nama}}] {{tanggal}} — {{daftar_alasan}}", vars)).toBe("[{{jumlah}}] 5 Mei 2026 — A / B");
  });

  it("reports the placeholders a sender cannot fill", () => {
    expect(unknownPlaceholders("{{nama}} {{x}} {{x}} {{y_z}}")).toEqual(["x", "y_z"]);
    expect(unknownPlaceholders("tanpa placeholder")).toEqual([]);
  });
});

describe("customerLines", () => {
  const today = "2026-09-12";
  const c = (nama: string, lastOrderDate: string | null, orderCycleDays = 30) => ({ nama, lastOrderDate, orderCycleDays });

  it("numbers the lines, longest wait first, and puts a customer that never ordered before all", () => {
    expect(customerLines([c("B", "2026-09-02"), c("A", "2026-07-01"), c("N", null, 14)], today)).toBe(
      [
        "1. N — belum pernah order (siklus normal 14 hari)",
        "2. A — 73 hari (siklus normal 30 hari)",
        "3. B — 10 hari (siklus normal 30 hari)",
      ].join("\n"),
    );
  });

  it("puts equal waits in name order, so the same customers always read the same way", () => {
    const lines = customerLines([c("Toko Z", "2026-08-01"), c("Toko A", "2026-08-01"), c("Toko M", "2026-08-01")], today);
    expect(lines.split("\n").map((l) => l.split(" — ")[0])).toEqual(["1. Toko A", "2. Toko M", "3. Toko Z"]);
  });

  it("is empty for nobody", () => {
    expect(customerLines([], today)).toBe("");
  });
});

describe("message templates", () => {
  beforeEach(() => resetDb());

  it("are seeded for whatsapp and email, but only whatsapp is offered for editing", () => {
    expect(activeTemplate("reminder_salesman", "email").subject).toContain("{{jumlah}}");
    expect(EDITABLE_TEMPLATE_CHANNELS).toEqual(["whatsapp"]);
    expect(listEditableTemplates().map((t) => `${t.code}/${t.channel}`)).toEqual([
      "reminder_salesman/whatsapp",
      "reminder_supervisor/whatsapp",
    ]);
  });

  it("saving inserts the next version and retires the old one — nothing is overwritten", async () => {
    const { admin } = await seedOrg();
    const live = activeTemplate("reminder_salesman", "whatsapp"); // the seeded text (version 2 since migration 0006)

    const next = saveTemplateVersion({
      code: "reminder_salesman",
      channel: "whatsapp",
      body: "  Pagi {{nama}}, {{jumlah}} customer menunggu: {{daftar_customer}}  ",
      createdById: admin.id,
    });

    expect(next).toMatchObject({ version: live.version + 1, isActive: true, createdById: admin.id, recipientKind: "salesman" });
    expect(next.body).toBe("Pagi {{nama}}, {{jumlah}} customer menunggu: {{daftar_customer}}");
    expect(activeTemplate("reminder_salesman", "whatsapp").id).toBe(next.id);
    const history = templateHistory("reminder_salesman", "whatsapp");
    expect(history[0]).toMatchObject({ version: live.version + 1, isActive: true });
    expect(history.slice(1).map((t) => t.isActive)).toEqual(history.slice(1).map(() => false)); // every earlier version is retired
    expect(history.map((t) => t.version)).toEqual(Array.from({ length: history.length }, (_, i) => live.version + 1 - i)); // none is missing
    expect(history[1].body).toBe(live.body); // the old text is intact
  });

  it("saving the text that is already live changes nothing", async () => {
    const { admin } = await seedOrg();
    const live = activeTemplate("reminder_supervisor", "whatsapp");
    const again = saveTemplateVersion({ code: "reminder_supervisor", channel: "whatsapp", body: live.body, createdById: admin.id });
    expect(again.id).toBe(live.id);
    expect(templateHistory("reminder_supervisor", "whatsapp")).toHaveLength(1);
    expect(logsFor("template", live.id)).toHaveLength(0);
  });

  it("rejects empty text, text that is too long, and placeholders it cannot fill", async () => {
    const { admin } = await seedOrg();
    const save = (body: string) =>
      saveTemplateVersion({ code: "reminder_salesman", channel: "whatsapp", body, createdById: admin.id });
    const versionsBefore = templateHistory("reminder_salesman", "whatsapp").length;
    expect(() => save("   ")).toThrow(/tidak boleh kosong/);
    expect(() => save("x".repeat(2001))).toThrow(/maksimal 2000/);
    expect(() => save("Halo {{nama}} {{tagihan}}")).toThrow(/Placeholder tidak dikenal: \{\{tagihan\}\}/);
    expect(templateHistory("reminder_salesman", "whatsapp")).toHaveLength(versionsBefore);
    expect(() => save("{{tanggal}} {{daftar_alasan}}")).not.toThrow(); // the new placeholders are accepted
  });

  it("logs the change in the audit trail with the old and the new text", async () => {
    const { admin } = await seedOrg();
    const before = activeTemplate("reminder_supervisor", "whatsapp");
    const next = saveTemplateVersion({ code: "reminder_supervisor", channel: "whatsapp", body: "Tim {{nama}}: {{jumlah}}", createdById: admin.id });
    const [entry] = logsFor("template", next.id);
    expect(entry).toMatchObject({ action: "update", entityLabel: "Ringkasan ke supervisor (whatsapp) v2", actorName: "Admin" });
    expect(entry.changes.body).toEqual({ from: before.body, to: "Tim {{nama}}: {{jumlah}}" });
  });

  it("a delivery keeps pointing at the version it was sent with, after the text is edited again", async () => {
    const { admin, salesman } = await seedOrg();
    addCustomer({ salesmanId: salesman.id, nama: "Toko", lastOrderDate: "2026-07-01" });
    const seeded = activeTemplate("reminder_salesman", "whatsapp").version;
    saveTemplateVersion({ code: "reminder_salesman", channel: "whatsapp", body: "V2 untuk {{nama}} ({{jumlah}})", createdById: admin.id });
    const sent: string[] = [];
    const run = await triggerBatch({
      triggeredById: admin.id,
      today: TODAY,
      client: { sendText: async (_to, text) => (sent.push(text), { ok: true }) },
    });
    expect(sent).toContain("V2 untuk Andi Sales (1)");

    saveTemplateVersion({ code: "reminder_salesman", channel: "whatsapp", body: "V3 {{nama}}", createdById: admin.id });
    const delivery = db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.runId, run!.id))
      .all()
      .find((d) => d.recipientKind === "salesman")!;
    const used = db.select().from(messageTemplates).where(eq(messageTemplates.id, delivery.templateId!)).get()!;
    expect(used).toMatchObject({ version: seeded + 1, body: "V2 untuk {{nama}} ({{jumlah}})" });
    expect(delivery.messageBody).toBe("V2 untuk Andi Sales (1)");
  });
});
