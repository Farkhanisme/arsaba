// lib/gaji.ts
// Single source of truth untuk perhitungan gaji pokok.
//
// Kenapa file ini ada
// ------------------
// Rumus baseGaji sebelumnya DIDUPLIKASI di dua tempat:
//   - app/api/payroll/generate/route.ts   (dipakai saat generate payslip)
//   - app/api/dashboard/gaji/route.ts     (dipakai untuk estimasi dashboard)
// Keduanya bisa berbeda diam-diam, sehingga "estimasi" di dashboard tidak lagi
// sama dengan payslip yang benar-benar dibayarkan. File ini yang menutup celah
// itu — semua pemanggil WAJIB lewat `hitungBaseGaji`.
//
// Aturan (§7.1 di spesifikasi)
// ----------------------------
//   HARIAN  → tarifPerHari x totalHariKerja   (BUKAN tarifPerJam x 8: jam kerja
//              berbeda per toko, jadi konstanta 8 tidak universal)
//   BULANAN → gajiPokokNominal                (nominal tetap, tidak perlu hadir)
//   JAM     → tarifPerJam  x totalJamTerbayar
//
// Catatan penting soal JAM
// -----------------------
// `floor` diterapkan PER HARI lalu dijumlah, bukan atas total menit sebulan
// (§7.1a). Karena itu parameter-nya `totalJamTerbayar: number` (sudah berupa
// jam bulat hasil floor per hari), bukan `totalMenitKerja`. Menghitung floor
// di dalam helper ini akan salah — lantai harus per hari.
//
// lib/absensi.ts tetap satu-satunya tempat untuk konstanta & helper waktu WIB.

import type { Prisma, TipePerhitunganGaji } from "@prisma/client";

/** Batas atas nominal (Rp). Sama dengan NOMINAL_MAX di API user/[id]/gaji. */
export const NOMINAL_MAX = 100_000_000;

/** Batas fisik menit kerja dalam sehari — untuk validasi koreksi manual. */
export const MENIT_PER_HARI = 1440;

export type InputBaseGaji = {
  tipe: TipePerhitunganGaji;
  tarifPerJam: number | null;
  tarifPerHari: number | null;
  gajiPokokNominal: number;
  /** Jumlah tanggalShift unik terverifikasi dalam periode. */
  totalHariKerja: number;
  /** Total jam SETELAH floor per hari (khusus tipe JAM). */
  totalJamTerbayar: number;
};

/**
 * Gaji pokok sebelum bonus/potongan.
 *
 * Mengembalikan 0 kalau tarif untuk tipenya null — itu kondisi data salah yang
 * harus terlihat, bukan crash. API PATCH /api/user/[id]/gaji sudah melarang
 * menyimpan tipe tanpa tarif wajibnya, jadi 0 di sini berarti data lama/seed.
 */
export function hitungBaseGaji(p: InputBaseGaji): number {
  switch (p.tipe) {
    case "HARIAN":
      return (p.tarifPerHari ?? 0) * p.totalHariKerja;
    case "BULANAN":
      return p.gajiPokokNominal;
    case "JAM":
      return (p.tarifPerJam ?? 0) * p.totalJamTerbayar;
    default:
      return 0;
  }
}

/** Hitung menit yang boleh dibayar untuk satu hari (floor per hari, §7.1a). */
export function jamTerbayarDariMenit(menit: number): number {
  return Math.max(0, Math.floor(menit / 60));
}

/**
 * Validasi kelengkapan tarif untuk sebuah tipe.
 * Mengembalikan pesan error, atau null bila valid.
 *
 * Ini yang mencegah bug P0-1 terulang: setiap tipe punya tarif wajibnya sendiri,
 * jadi tidak ada cara menyimpan tipe yang "aktif tapi tanpa tarif".
 */
export function validasiTarif(
  tipe: TipePerhitunganGaji,
  v: { tarifPerJam: number | null; tarifPerHari: number | null; gajiPokokNominal: number | null }
): string | null {
  switch (tipe) {
    case "JAM":
      return v.tarifPerJam === null
        ? "Tipe 'JAM' wajib menyertakan 'tarifPerJam'."
        : null;
    case "HARIAN":
      return v.tarifPerHari === null
        ? "Tipe 'HARIAN' wajib menyertakan 'tarifPerHari' (tarif harian, bukan tarif per jam)."
        : null;
    case "BULANAN":
      return v.gajiPokokNominal === null
        ? "Tipe 'BULANAN' wajib menyertakan 'nominalGajiPokok'."
        : null;
    default:
      return "Field 'tipePerhitunganGaji' tidak valid.";
  }
}

/** Nama field tarif yang wajib untuk sebuah tipe — untuk pesan error UI. */
export function fieldWajibUntukTipe(tipe: TipePerhitunganGaji): string {
  switch (tipe) {
    case "JAM":
      return "tarifPerJam";
    case "HARIAN":
      return "tarifPerHari";
    case "BULANAN":
      return "nominalGajiPokok";
    default:
      return "—";
  }
}

// ============================================================
// Guard payroll LOCKED
// ============================================================
// Dipakai oleh route yang mengubah angka yang sudah terpakai payroll:
//   - PATCH /api/agenda/[id]/nominal      (bonus agenda)
//   - POST /api/agenda/nominal-batch      (bonus agenda, massal)
//   - POST /api/absensi/[id]/koreksi-jam  (koreksi jam tipe JAM)
//
// Kenapa perlu: `Payroll.status = "LOCKED"` berarti payslip-nya sudah final.
// Kalau sumber angkanya (nominal agenda / jam kerja) masih boleh diubah, maka
// payslip dan dashboard estimasi menampilkan angka BERBEDA — dan tidak ada jalan
// memperbaikinya karena `PATCH /api/payroll/[id]` memang menolak saat LOCKED.
//
// Catatan konvensi: `Payroll.periode` = tanggal 1 bulan jam 0 UTC.
// `Attendance.tanggalShift` = kolom @db.Date, yaitu UTC midnight dari tanggal
// kalender WIB-nya. Jadi konversinya cukup ambil Year/Month dari ISO string.

/** Ubah `tanggalShift` (@db.Date) menjadi objek Date periode payroll. */
export function periodeDariTanggalShift(tanggalShift: Date): Date {
  const [y, m] = tanggalShift.toISOString().slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
}

/** Format periode payroll sebagai "YYYY-MM" (untuk pesan error). */
export function formatPeriode(periode: Date): string {
  return periode.toISOString().slice(0, 7);
}

/** Bentuk minimal dari PrismaClient / TransactionClient yang dibutuhkan. */
type PrismaLike = {
  payroll: {
    findFirst(args: {
      where: { employeeId: string; periode: Date; status: string };
      select: { id: true; periode: true };
    }): Promise<{ id: string; periode: Date } | null>;
  };
};

/**
 * True kalau sudah ada payroll LOCKED untuk (employee, periode).
 * Client boleh `prisma` maupun `tx` di dalam `$transaction`.
 */
export async function payrollLocked(
  client: PrismaLike,
  employeeId: string,
  tanggalShift: Date
): Promise<boolean> {
  if (!employeeId) return false;
  const periode = periodeDariTanggalShift(tanggalShift);
  const found = await client.payroll.findFirst({
    where: { employeeId, periode, status: "LOCKED" },
    select: { id: true, periode: true },
  });
  return found !== null;
}

/** Pesan 409 yang konsisten saat payroll sudah terkunci. */
export function pesanPayrollLocked(tanggalShift: Date): string {
  return `Payroll ${formatPeriode(periodeDariTanggalShift(tanggalShift))} sudah dikunci. Gunakan mekanisme revisi (§7.1b) sebelum mengubah angka ini.`;
}

// ============================================================
// Antrean verifikasi yang belum tuntas (Opsi B)
// ============================================================

/** Bentuk minimal PrismaClient untuk membaca antrean verifikasi absensi. */
type AttendanceClientLike = {
  attendance: {
    findMany: (
      args: Prisma.AttendanceFindManyArgs
    ) => Promise<AbsensiMenungguVerifikasi[]>;
  };
};

export type AbsensiMenungguVerifikasi = { id: string; tanggalShift: Date };

/**
 * Absensi pada (employee, periode) yang masih `PENDING_VERIFIKASI` — artinya
 * hari itu **belum masuk hitungan gaji** sampai ada yang memverifikasinya.
 *
 *_aturan ini menutup lubang "hari kerja hilang tanpa suara": sebelumnya payslip
 * bisa dikunci sambil diam-diam melewati hari yang sudah orang kerjakan, karena
 * `payroll/generate` hanya menghitung `statusMasuk: "DIVERIFIKASI"`.
 *
 * PENTING — hanya `statusMasuk` yang diperiksa:
 *   - `statusKeluar` yang masih pending **tidak boleh memblokir**. Perhitungan
 *     gaji tidak memfilter `statusKeluar` sama sekali, jadi record seperti itu
 *     sudah terbayar dan tidak mengubah apa pun. Memasukkannya akan mengunci
 *     payslip tanpa jalan keluar, karena status itu hanya bisa ditutup lewat
 *     log KELUAR.
 *   - `DITOLAK` juga tidak memblokir. Penolakan adalah keputusan sadar, sama
 *     dengan "sudah diselesaikan" — bukan pekerjaan yang tertinggal.
 */
export async function absensiMenungguVerifikasi(
  client: AttendanceClientLike,
  employeeId: string,
  periode: Date
): Promise<AbsensiMenungguVerifikasi[]> {
  if (!employeeId) return [];
  const tahun = periode.getUTCFullYear();
  const bulan = periode.getUTCMonth();
  return client.attendance.findMany({
    where: {
      employeeId,
      tanggalShift: { gte: new Date(Date.UTC(tahun, bulan, 1)), lt: new Date(Date.UTC(tahun, bulan + 1, 1)) },
      statusMasuk: "PENDING_VERIFIKASI",
    },
    select: { id: true, tanggalShift: true },
    orderBy: { tanggalShift: "asc" },
  });
}

/** Pesan 409 + tujuan perbaikan untuk antrean verifikasi yang belum tuntas. */
export function pesanAbsensiMenungguVerifikasi(
  rows: AbsensiMenungguVerifikasi[],
  employeeName?: string
): string {
  const n = rows.length;
  const tanggal = rows.map((r) => r.tanggalShift.toISOString().slice(0, 10)).join(", ");
  const siapa = employeeName ? ` untuk ${employeeName}` : "";
  return (
    `Ada ${n} absensi${siapa} yang belum diverifikasi pada ${tanggal}. ` +
    `Hari-hari itu tidak dihitung dalam gaji, jadi payslip ini akan kehilangan hari kerja. ` +
    `Verifikasi atau tolak absensi tersebut di /verifikasi/absensi sebelum mengunci.`
  );
}

// ============================================================
// Koreksi jam manual (P0-7, spesifikasi §7.1a)
// ============================================================

/**
 * Menit yang boleh dibayar untuk satu record Attendance.
 *
 * `totalMenitManual` = koreksi Manajer (null = belum dikoreksi).
 * Nilai server `totalMenitKerja` TIDAK pernah diubah oleh koreksi, jadi
 * asal-usul angka selalu bisa dibandingkan.
 */
export function menitEfektif(a: {
  totalMenitKerja: number;
  totalMenitManual: number | null;
}): number {
  return a.totalMenitManual ?? a.totalMenitKerja;
}
