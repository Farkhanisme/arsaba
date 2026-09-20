import { prisma } from "@/lib/prisma";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Konversi Date (UTC instant) ke tanggal WIB, dikembalikan sebagai Date di UTC midnight.
export function computeTanggalShiftWIB(date: Date): Date {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return new Date(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate())
  );
}

export type HasilCariAssignment = {
  shiftMulai: Date | null;
  shiftSelesai: Date | null;
  menitTelat: number;
  potongan: number;
};

// Cari assignment yang paling cocok untuk absenMasuk pada tanggalShift.
// Aturan:
//  - Kalau tidak ada assignment → semua null/0.
//  - Kalau assignment ada tapi jadwal belum APPROVED → semua null/0
//    (akan direcompute saat approve).
//  - Kalau jamMulai paling dekat dengan absenMasuk dipilih sebagai kandidat.
//  - Rumus: menitTelat = max(0, floor((absenMasuk - jamMulai) / 60000) - 5);
//           potongan   = menitTelat * 1000.
export async function cariDanHitungUntukCheckIn(
  employeeId: string,
  absenMasuk: Date,
  tanggalShift: Date
): Promise<HasilCariAssignment> {
  const kosong: HasilCariAssignment = {
    shiftMulai: null,
    shiftSelesai: null,
    menitTelat: 0,
    potongan: 0,
  };

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      employeeId,
      shiftInstance: { tanggal: tanggalShift },
    },
    include: {
      shiftInstance: { select: { statusJadwal: true } },
    },
  });

  if (assignments.length === 0) return kosong;

  // Pilih jamMulai paling dekat dengan absenMasuk
  let best = assignments[0]!;
  let bestDist = Math.abs(best.jamMulai.getTime() - absenMasuk.getTime());
  for (let i = 1; i < assignments.length; i++) {
    const a = assignments[i]!;
    const dist = Math.abs(a.jamMulai.getTime() - absenMasuk.getTime());
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }

  if (best.shiftInstance.statusJadwal !== "APPROVED") return kosong;

  const diffMs = absenMasuk.getTime() - best.jamMulai.getTime();
  const diffMenit = Math.floor(diffMs / 60000);
  const menitTelat = Math.max(0, diffMenit - 5);
  const potongan = menitTelat * 1000;

  return {
    shiftMulai: best.jamMulai,
    shiftSelesai: best.jamSelesai,
    menitTelat,
    potongan,
  };
}
