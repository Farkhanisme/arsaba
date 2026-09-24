import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import type { Prisma } from "@prisma/client";

// Helper shared untuk modul penyetoran uang (§penyetoran-uang.md §6).
// RBAC tetap divalidasi di masing-masing API route — file ini hanya util murni.

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const PERIODE_RE = /^\d{4}-\d{2}$/;

export const MAX_FOTO = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
export const MAX_KETERANGAN = 200;
// Batas atas nominal rupiah = max PostgreSQL integer (kolom Int).
// Validasi di parseNominal agar over-limit jadi 400, bukan 500 dari DB.
export const MAX_NOMINAL = 2147483647;

export const STATUS_VALID = [
  "MENUNGGU_KONFIRMASI",
  "DITERIMA",
  "DIBATALKAN",
] as const;

export type SetoranDenganRelasi = Prisma.SetoranUangGetPayload<{
  include: {
    dariStore: { select: { nama: true } };
    tokoTujuan: { select: { nama: true } };
    disetorkanOleh: { select: { nama: true } };
    diterimaOleh: { select: { nama: true } };
    batalOleh: { select: { nama: true } };
    bukti: {
      select: { id: true; jenis: true; fileId: true; namaFile: true };
      orderBy: { createdAt: "asc" };
    };
  };
}>;

export const setoranInclude = {
  dariStore: { select: { nama: true } },
  tokoTujuan: { select: { nama: true } },
  disetorkanOleh: { select: { nama: true } },
  diterimaOleh: { select: { nama: true } },
  batalOleh: { select: { nama: true } },
  bukti: {
    select: { id: true, jenis: true, fileId: true, namaFile: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.SetoranUangInclude;

// Serialisasi satu record setoran untuk response API.
// Hanya nama/kode toko & pelaku — tanpa PII (tanpa hashedPassword, NIK, dsb).
export function serializeSetoran(s: SetoranDenganRelasi) {
  return {
    id: s.id,
    dariStoreId: s.dariStoreId,
    dariStoreNama: s.dariStore.nama,
    tipeTujuan: s.tipeTujuan,
    tokoTujuanId: s.tokoTujuanId,
    tokoTujuanNama: s.tokoTujuan?.nama ?? null,
    nominalDisetor: s.nominalDisetor,
    keterangan: s.keterangan,
    status: s.status,
    disetorkanOlehId: s.disetorkanOlehId,
    disetorkanOlehNama: s.disetorkanOleh.nama,
    disetorkanPada: s.disetorkanPada.toISOString(),
    nominalDiterima: s.nominalDiterima,
    selisih: s.selisih,
    keteranganSelisih: s.keteranganSelisih,
    diterimaOlehId: s.diterimaOlehId,
    diterimaOlehNama: s.diterimaOleh?.nama ?? null,
    diterimaPada: s.diterimaPada ? s.diterimaPada.toISOString() : null,
    batalOlehNama: s.batalOleh?.nama ?? null,
    batalPada: s.batalPada ? s.batalPada.toISOString() : null,
    alasanBatal: s.alasanBatal,
    bukti: s.bukti.map((b) => ({
      id: b.id,
      jenis: b.jenis,
      fileId: b.fileId,
      namaFile: b.namaFile,
    })),
    createdAt: s.createdAt.toISOString(),
  };
}

// Parse & validasi periode YYYY-MM → rentang bulan (WIB midnight).
// Default: bulan berjalan WIB bila param null/undefined.
// Batas dikonversi ke UTC instant (tengah malam WIB = 17:00 UTC hari sebelumnya)
// karena disetorkanPada adalah TIMESTAMP penuh — filter UTC midnight akan
// melempar setoran 00:00–06:59 WIB tgl 1 ke bulan sebelumnya.
export function parsePeriode(
  periodeParam: string | null
): { ok: true; periode: string; awalBulan: Date; akhirBulan: Date } | { ok: false; error: string } {
  const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
  const defaultPeriode = `${wibNow.getUTCFullYear()}-${String(
    wibNow.getUTCMonth() + 1
  ).padStart(2, "0")}`;
  const periode = periodeParam ?? defaultPeriode;

  if (!PERIODE_RE.test(periode)) {
    return { ok: false, error: "Format periode harus YYYY-MM (contoh: 2026-09)." };
  }
  const [yearStr, monthStr] = periode.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month < 1 || month > 12) {
    return { ok: false, error: "Bulan tidak valid (1-12)." };
  }
  return {
    ok: true,
    periode,
    awalBulan: new Date(Date.UTC(year, month - 1, 1) - WIB_OFFSET_MS),
    akhirBulan: new Date(Date.UTC(year, month, 1) - WIB_OFFSET_MS),
  };
}

// Ambil array File dari FormData (abaikan entry kosong yang dikirim browser).
export function getFotoFiles(formData: FormData): File[] {
  return formData
    .getAll("foto")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File && v.size > 0);
}

// Validasi satu file bukti. Return pesan error, atau null bila valid.
export function validateFotoFile(f: File): string | null {
  if (!ALLOWED_MIME.includes(f.type)) {
    return `File '${f.name || "tanpa nama"}' harus berupa gambar (jpeg/png/webp).`;
  }
  if (f.size > MAX_FILE_BYTES) {
    return `File '${f.name || "tanpa nama"}' melebihi 10 MB.`;
  }
  return null;
}

// Upload banyak file bukti ke Telegram. Throw bila ada yang gagal
// (route menangkap & memetakan ke 500 — pola app/api/absensi/route.ts).
// Known limitation (sama seperti absensi): upload terjadi SEBELUM transaksi DB,
// jadi bila transaksi gagal setelah upload, file yatim tetap ada di Telegram
// tanpa referensi file_id di DB. Diterima untuk v1 (kasus langka, tak bernilai uang).
export async function uploadBuktiFiles(
  files: File[],
  prefix: string
): Promise<{ fileId: string; namaFile: string | null }[]> {
  const hasil: { fileId: string; namaFile: string | null }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const buffer = Buffer.from(await f.arrayBuffer());
    const filename = f.name || `${prefix}-${Date.now()}-${i}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, {
      asDocument: false,
    });
    hasil.push({ fileId: uploadResult.fileId, namaFile: f.name || filename });
  }
  return hasil;
}

// Validasi nominal rupiah: integer 1–MAX_NOMINAL. Return number, atau null bila invalid.
export function parseNominal(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_NOMINAL) return null;
  return n;
}

export { prisma };
