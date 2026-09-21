const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Konversi Date (UTC instant) ke tanggal WIB, dikembalikan sebagai Date di UTC midnight.
export function computeTanggalShiftWIB(date: Date): Date {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return new Date(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate())
  );
}
