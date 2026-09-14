import { relations, sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
});

export const supervisors = sqliteTable("supervisors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nama: text("nama").notNull(),
  nomorWa: text("nomor_wa").notNull().default(""),
});

export const salesmen = sqliteTable("salesmen", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nama: text("nama").notNull(),
  nomorWa: text("nomor_wa").notNull().default(""),
  supervisorId: integer("supervisor_id").references(() => supervisors.id),
  status: text("status", { enum: ["aktif", "inactive"] })
    .notNull()
    .default("aktif"),
});

export const customers = sqliteTable(
  "customers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nama: text("nama").notNull(),
    salesmanId: integer("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    tipeCustomer: text("tipe_customer", { enum: ["lama", "baru"] }).notNull(),
    orderCycleDays: integer("order_cycle_days").notNull().default(30),
    statusCustomer: text("status_customer", { enum: ["aktif", "inactive"] })
      .notNull()
      .default("aktif"),
    lastOrderDate: text("last_order_date"),
    notified: integer("notified", { mode: "boolean" }).notNull().default(false),
    handledOn: text("handled_on"),
  },
  (t) => [
    uniqueIndex("unique_customer_name_per_salesman").on(t.nama, t.salesmanId),
    check("order_cycle_days_min", sql`${t.orderCycleDays} >= 1`),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["admin", "supervisor", "salesman", "management"],
    }).notNull(),
    salesmanId: integer("salesman_id").references(() => salesmen.id),
    supervisorId: integer("supervisor_id").references(() => supervisors.id),
  },
  (t) => [
    check(
      "profile_role_link_matches_role",
      sql`(
        (${t.role} = 'salesman' AND ${t.salesmanId} IS NOT NULL AND ${t.supervisorId} IS NULL)
        OR (${t.role} = 'supervisor' AND ${t.supervisorId} IS NOT NULL AND ${t.salesmanId} IS NULL)
        OR (${t.role} IN ('admin', 'management') AND ${t.salesmanId} IS NULL AND ${t.supervisorId} IS NULL)
      )`,
    ),
  ],
);

export const transaksi = sqliteTable("transaksi", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  salesmanId: integer("salesman_id")
    .notNull()
    .references(() => salesmen.id),
  tanggalOrder: text("tanggal_order").notNull(),
  sumber: text("sumber", { enum: ["seed", "import", "manual"] }).notNull(),
  tanggalInput: text("tanggal_input")
    .notNull()
    .default(sql`(date('now'))`),
  catatan: text("catatan").notNull().default(""),
}); // DEBT-009: editable/deletable — departs from FRD BR-10 append-only

/** @deprecated use `transaksi` */
export const orderHistory = transaksi;

export const reasonLogs = sqliteTable("reason_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  salesmanId: integer("salesman_id")
    .notNull()
    .references(() => salesmen.id),
  tanggal: text("tanggal")
    .notNull()
    .default(sql`(date('now'))`),
  kodeAlasan: text("kode_alasan", { enum: ["1", "2", "3"] }).notNull(),
});

export const notificationBatches = sqliteTable("notification_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tanggal: text("tanggal")
    .notNull()
    .default(sql`(datetime('now'))`),
  triggeredById: integer("triggered_by_id")
    .notNull()
    .references(() => users.id),
});

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => notificationBatches.id),
    salesmanId: integer("salesman_id").references(() => salesmen.id),
    supervisorId: integer("supervisor_id").references(() => supervisors.id),
    customerCount: integer("customer_count").notNull().default(0),
    status: text("status", {
      enum: ["sent", "failed", "skipped_no_phone"],
    }).notNull(),
    errorMessage: text("error_message").notNull().default(""),
  },
  (t) => [
    check(
      "delivery_exactly_one_recipient",
      sql`(
        (${t.salesmanId} IS NOT NULL AND ${t.supervisorId} IS NULL)
        OR (${t.salesmanId} IS NULL AND ${t.supervisorId} IS NOT NULL)
      )`,
    ),
  ],
);

export const mutationLogs = sqliteTable("mutation_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  dariSalesmanId: integer("dari_salesman_id")
    .notNull()
    .references(() => salesmen.id),
  keSalesmanId: integer("ke_salesman_id")
    .notNull()
    .references(() => salesmen.id),
  tanggal: text("tanggal")
    .notNull()
    .default(sql`(datetime('now'))`),
  olehId: integer("oleh_id")
    .notNull()
    .references(() => users.id),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export const statusLogs = sqliteTable("status_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  tipe: text("tipe", {
    enum: ["manual_inactive", "manual_reactivation", "auto_reactivation"],
  }).notNull(),
  tanggal: text("tanggal")
    .notNull()
    .default(sql`(datetime('now'))`),
  olehId: integer("oleh_id").references(() => users.id),
});

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
  salesman: one(salesmen, {
    fields: [profiles.salesmanId],
    references: [salesmen.id],
  }),
  supervisor: one(supervisors, {
    fields: [profiles.supervisorId],
    references: [supervisors.id],
  }),
}));

export const REASON_LABELS = {
  "1": "Kalah Harga",
  "2": "Stok Masih Ada",
  "3": "Sudah Bangkrut",
} as const;

export type Role = "admin" | "supervisor" | "salesman" | "management";
export type ReasonCode = keyof typeof REASON_LABELS;
