import { format as formatDateFns } from "date-fns";
import { id as localeId } from "date-fns/locale";

/**
 * Format tanggal lengkap: "17 September 2026"
 */
export function formatTanggal(date: Date): string {
  return formatDateFns(date, "d MMMM yyyy", { locale: localeId });
}

/**
 * Format waktu 24 jam: "HH:mm"
 */
export function formatWaktu(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Format rupiah: "Rp 1.000.000"
 */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}