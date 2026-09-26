/** Placeholders a message template may use. Shared by the sender (server) and the editor (client). */
export const TEMPLATE_PLACEHOLDERS = ["nama", "jumlah", "tanggal", "daftar_customer", "daftar_alasan"] as const;
export type TemplateVars = Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | number>;
