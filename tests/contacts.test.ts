import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { salesmanContacts } from "~/db/schema";
import { attachWhatsapp, primaryContact, setWhatsappNumber, whatsappNumber } from "~/lib/contacts.server";
import { createSalesman, updateSalesman } from "~/lib/masterdata.server";

import { resetDb, seedOrg, logsFor } from "./helpers/fixtures";

const rowsOf = (salesmanId: number) =>
  db.select().from(salesmanContacts).where(eq(salesmanContacts.salesmanId, salesmanId)).all();

describe("salesman contacts (WhatsApp)", () => {
  beforeEach(() => resetDb());

  it("a number becomes the primary whatsapp contact; blank means none", async () => {
    const { salesman } = await seedOrg({ salesmanWa: "" });
    expect(whatsappNumber(salesman.id)).toBe("");
    setWhatsappNumber(salesman.id, "  628777 ");
    expect(primaryContact(salesman.id, "whatsapp")).toMatchObject({
      address: "628777",
      channel: "whatsapp",
      isPrimary: true,
      isVerified: false,
    });
    expect(whatsappNumber(salesman.id)).toBe("628777");
  });

  it("changing the number edits the contact in place and drops 'verified'; the same number writes nothing", async () => {
    const { salesman } = await seedOrg();
    const first = primaryContact(salesman.id, "whatsapp")!;
    db.update(salesmanContacts).set({ isVerified: true }).where(eq(salesmanContacts.id, first.id)).run();

    setWhatsappNumber(salesman.id, "628222222222"); // unchanged
    expect(primaryContact(salesman.id, "whatsapp")).toMatchObject({ id: first.id, isVerified: true, updatedAt: first.updatedAt });

    setWhatsappNumber(salesman.id, "628555");
    const after = primaryContact(salesman.id, "whatsapp")!;
    expect(after).toMatchObject({ id: first.id, address: "628555", isVerified: false });
    expect(rowsOf(salesman.id)).toHaveLength(1);
  });

  it("clearing the number soft-deletes the contact, and a later number starts a new one", async () => {
    const { salesman } = await seedOrg();
    setWhatsappNumber(salesman.id, "");
    expect(whatsappNumber(salesman.id)).toBe("");
    expect(rowsOf(salesman.id)).toHaveLength(1);
    expect(rowsOf(salesman.id)[0].deletedAt).not.toBeNull();

    setWhatsappNumber(salesman.id, "628111");
    expect(rowsOf(salesman.id)).toHaveLength(2);
    expect(whatsappNumber(salesman.id)).toBe("628111");
  });

  it("only one live primary contact per salesman and channel is allowed", async () => {
    const { salesman } = await seedOrg();
    expect(() =>
      db.insert(salesmanContacts).values({ salesmanId: salesman.id, channel: "whatsapp", address: "628000", isPrimary: true }).run(),
    ).toThrow(/UNIQUE/);
    // Other channels, and non-primary contacts, are fine.
    expect(() =>
      db.insert(salesmanContacts).values({ salesmanId: salesman.id, channel: "email", address: "a@x.id", isPrimary: true }).run(),
    ).not.toThrow();
    expect(whatsappNumber(salesman.id)).toBe("628222222222");
  });

  it("attachWhatsapp adds the number to many salesmen at once", async () => {
    const { supervisor, salesman, salesmanB } = await seedOrg({ salesmanWa: "" });
    const rows = attachWhatsapp([supervisor, salesman, salesmanB]);
    expect(rows.map((r) => [r.nama, r.nomorWa])).toEqual([
      ["Budi Supervisor", "628111111111"],
      ["Andi Sales", ""],
      ["Citra Sales", "628333333333"],
    ]);
    expect(attachWhatsapp([])).toEqual([]);
  });

  it("createSalesman / updateSalesman keep the form's single 'Nomor WA' field working, and log it", async () => {
    const { admin } = await seedOrg();
    const created = createSalesman({ nama: "Dewi", nomorWa: "6289", actingUserId: admin.id });
    expect(created.nomorWa).toBe("6289");
    expect(whatsappNumber(created.id)).toBe("6289");

    updateSalesman({ id: created.id, nama: "Dewi", nomorWa: "62890", supervisorId: null, status: "aktif", actingUserId: admin.id });
    expect(whatsappNumber(created.id)).toBe("62890");
    const [update, create] = logsFor("salesman", created.id);
    expect(create.changes.nomor_wa).toEqual({ from: null, to: "6289" });
    expect(update.changes).toEqual({ nomor_wa: { from: "6289", to: "62890" } });
  });
});
