import { prisma } from "@/lib/prisma";

// Pusat logika absensi (§5.1, §5.1a, §5.3).
// Semua konversi waktu-WIB dan aturan pencocokan shift BERADA di file ini —
// jangan duplikasi konstanta WIB_OFFSET_MS di komponen/page (semua pemanggil
// pakai helper di bawah).

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Toleransi keterlambatan. Menit telat yang dihitung server HANYA sebagai
// saran: `max(0, menit telat - TOLERANSI_MENIT)`. Admin/Supervisor tetap
// mengisi `menitTelat` saat verifikasi dan angka itu yang jadi acuan.
export const TOLERANSI_MENIT = 5;

// Potongan keterlambatan per menit (Rp1.000) — §5.1.
export const POTONGAN_PER_MENIT = 1000;

// Shift menggantung lebih dari ini akan di-auto-close saat check-in berikutnya.
export const AUTO_CLOSE_MS = 20 * 60 * 60 * 1000;

// Jendela pencocokan check-in ke shift: check-in.boleh sampai 4 jam SEBELUM
// jamMulai (karyawan datang lebih awal) dan masih terikat shift selama belum
// lewat jamSelesai.
export const JENDELA_CHECKIN_EARLY_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Konversi waktu WIB
// ---------------------------------------------------------------------------

// Konversi Date (UTC instant) ke tanggal WIB, dikembalikan sebagai Date di UTC midnight.
export function computeTanggalShiftWIB(date: Date): Date {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

// "YYYY-MM-DD" dari tanggal kalender WIB.
export function formatTanggalWIB(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// "14:30" (jam saja, tanpa tanggal) — untuk label ringkas di daftar.
export function formatJamWIB(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return `${String(wib.getUTCHours()).padStart(2, "0")}:${String(wib.getUTCMinutes()).padStart(2, "0")}`;
}

// "28/09/2026"
export function formatTanggalPanjangWIB(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return `${String(wib.getUTCDate()).padStart(2, "0")}/${String(wib.getUTCMonth() + 1).padStart(2, "0")}/${wib.getUTCFullYear()}`;
}

// "28/09/2026 14:30 WIB"
export function formatWaktuWIB(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mi = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} WIB`;
}

// Tautan Google Maps untuk satu titik lat/long. Tidak menghitung jarak ke
// toko (§5.1) — hanya membuka lokasi di peta.
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// ---------------------------------------------------------------------------
// Hitungan keterlambatan
// ---------------------------------------------------------------------------

export function hitungMenitTelat(absenMasuk: Date, jamMulai: Date): number {
  const menit = Math.floor((absenMasuk.getTime() - jamMulai.getTime()) / 60000);
  return Math.max(0, menit);
}

// Saran menit telat untuk form verifikasi: telat dikurangi toleransi 5 menit.
// Kalau tidak ada shift acuan, tidak ada saran (admin isi manual).
export function saranMenitTelat(
  absenMasuk: Date,
  jamMulai: Date | null
): number | null {
  if (!jamMulai) return null;
  return Math.max(0, hitungMenitTelat(absenMasuk, jamMulai) - TOLERANSI_MENIT);
}

// Server yang menghitung `potongan` supaya tidak bisa dimanipulasi client (§5.1).
export function hitungPotongan(menitTelat: number): number {
  return menitTelat * POTONGAN_PER_MENIT;
}

export function hitungTotalMenitKerja(absenMasuk: Date, absenKeluar: Date): number {
  return Math.max(
    0,
    Math.floor((absenKeluar.getTime() - absenMasuk.getTime()) / 60000)
  );
}

// ---------------------------------------------------------------------------
// Pencocokan shift
// ---------------------------------------------------------------------------

export type ShiftAcuan = {
  assignmentId: string;
  segmen: "NORMAL" | "PAM";
  tanggal: Date;
  jamMulai: Date;
  jamSelesai: Date;
  storeId: string;
  storeNama: string;
};

// Shift APPROVED terdekat yang AKAN datang (jamMulai > ref), dalam jendela
// 12 jam ke depan. Dipakai dashboard karyawan untuk menampilkan shift
// berikutnya — bukan untuk atribusi tanggal (itu pakai findShiftAcuan).
export async function findShiftBerikutnya(
  employeeId: string,
  ref: Date
): Promise<ShiftAcuan | null> {
  const batas = new Date(ref.getTime() + 12 * 60 * 60 * 1000);
  const a = await prisma.shiftAssignment.findFirst({
    where: {
      employeeId,
      shiftInstance: { statusJadwal: "APPROVED" },
      jamMulai: { gt: ref, lte: batas },
    },
    include: {
      shiftInstance: {
        select: {
          tanggal: true,
          jamMulai: true,
          jamSelesai: true,
          storeId: true,
          store: { select: { nama: true } },
        },
      },
    },
    orderBy: { jamMulai: "asc" },
  });
  return a
    ? {
        assignmentId: a.id,
        segmen: a.segmen,
        tanggal: a.shiftInstance.tanggal,
        jamMulai: a.shiftInstance.jamMulai,
        jamSelesai: a.shiftInstance.jamSelesai,
        storeId: a.shiftInstance.storeId,
        storeNama: a.shiftInstance.store.nama,
      }
    : null;
}

// Cari ShiftAssignment APPROVED yang mencakup `ref` untuk karyawan ini.
// Match kalau jamMulai <= ref + 4 jam DAN jamSelesai > ref — jadi check-in
// tepat jam mulai, beberapa jam lebih awal, maupun check-in jam 02.00 untuk
// shift 18.00–06.00 (lintas tengah malam) semuanya kena.
export async function findShiftAcuan(
  employeeId: string,
  ref: Date
): Promise<ShiftAcuan | null> {
  const batasMulai = new Date(ref.getTime() + JENDELA_CHECKIN_EARLY_MS);
  return prisma.shiftAssignment.findFirst({
    where: {
      employeeId,
      shiftInstance: { statusJadwal: "APPROVED" },
      jamMulai: { lte: batasMulai },
      jamSelesai: { gt: ref },
    },
    include: {
      shiftInstance: {
        select: {
          tanggal: true,
          jamMulai: true,
          jamSelesai: true,
          storeId: true,
          store: { select: { nama: true } },
        },
      },
    },
    orderBy: { jamMulai: "desc" },
  }).then((a) =>
    a
      ? {
          assignmentId: a.id,
          segmen: a.segmen,
          tanggal: a.shiftInstance.tanggal,
          jamMulai: a.shiftInstance.jamMulai,
          jamSelesai: a.shiftInstance.jamSelesai,
          storeId: a.shiftInstance.storeId,
          storeNama: a.shiftInstance.store.nama,
        }
      : null
  );
}

// Versi batch untuk halaman verifikasi (satu query untuk banyak employee).
export async function findShiftAcuanBatch(
  entries: Array<{ employeeId: string; ref: Date }>
): Promise<Map<string, ShiftAcuan | null>> {
  const hasil = new Map<string, ShiftAcuan | null>();
  if (entries.length === 0) return hasil;

  const byEmployee = new Map<string, Date>();
  for (const e of entries) {
    // Kalau satu employee punya beberapa entri, ambil yang paling baru.
    const prev = byEmployee.get(e.employeeId);
    if (!prev || e.ref > prev) byEmployee.set(e.employeeId, e.ref);
  }

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      OR: [...byEmployee.entries()].map(([employeeId, ref]) => ({
        employeeId,
        shiftInstance: { statusJadwal: "APPROVED" },
        jamMulai: { lte: new Date(ref.getTime() + JENDELA_CHECKIN_EARLY_MS) },
        jamSelesai: { gt: ref },
      })),
    },
    include: {
      shiftInstance: {
        select: {
          tanggal: true,
          jamMulai: true,
          jamSelesai: true,
          storeId: true,
          store: { select: { nama: true } },
        },
      },
    },
    orderBy: { jamMulai: "desc" },
  });

  const seen = new Set<string>();
  for (const a of assignments) {
    if (seen.has(a.employeeId)) continue;
    seen.add(a.employeeId);
    hasil.set(a.employeeId, {
      assignmentId: a.id,
      segmen: a.segmen,
      tanggal: a.shiftInstance.tanggal,
      jamMulai: a.shiftInstance.jamMulai,
      jamSelesai: a.shiftInstance.jamSelesai,
      storeId: a.shiftInstance.storeId,
      storeNama: a.shiftInstance.store.nama,
    });
  }
  for (const employeeId of byEmployee.keys()) {
    if (!hasil.has(employeeId)) hasil.set(employeeId, null);
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Auto-close
// ---------------------------------------------------------------------------

// Absen keluar untuk shift yang menggantung: pakai jamSelesai shift (supaya
// totalMenitKerja tidak melebihi jadwal), fallback ke absenMasuk kalau shift
// sudah tidak ditemukan.
export function hitungAbsenKeluarAutoClose(
  absenMasuk: Date,
  shift: { jamSelesai: Date } | null
): Date {
  if (!shift) return absenMasuk;
  // Jangan sampai lebih awal dari absenMasuk (mis. shift yang belum dimulai).
  if (shift.jamSelesai <= absenMasuk) return absenMasuk;
  return shift.jamSelesai;
}
