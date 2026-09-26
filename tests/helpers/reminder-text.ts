/**
 * The lines a reminder to a salesman ends with: how to answer it. `reasons` is the list of
 * offered reasons as the message prints it ("Kalah Harga / Stok Masih Ada / Sudah Bangkrut").
 */
export const replyInstructions = (reasons: string) => [
  "*Cara membalas:* tekan Balas (reply) pada pesan ini, lalu tulis:",
  "• Satu/beberapa customer: nomor + alasan",
  "  contoh: 3 Kalah Harga  atau  1,2,5 Stok Masih Ada",
  "• Semua customer: alasannya saja",
  "  contoh: Stok Masih Ada",
  `Pilihan alasan: ${reasons}. Boleh juga menulis alasan Anda sendiri.`,
];
