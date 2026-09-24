import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["MANAJER"];

interface GenerateBody {
  periode: string; // "YYYY-MM"
}

interface PayrollItemResult {
  employeeId: string;
  employeeKode: string;
  employeeNama: string;
  gajiPokok: number;
  totalHariKerja: number | null;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  bonusManual: number;
  potonganManual: number;
  bonusPerforma: number;
  keteranganBonusPerforma: string | null;
  totalGaji: number;
  status: string;
  action: "created" | "skipped";
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya MANAJER yang boleh generate payroll." },
        { status: 403 }
      );
    }

    let body: GenerateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const { periode } = body;
    if (!periode || typeof periode !== "string") {
      return NextResponse.json({ error: "Field 'periode' (YYYY-MM) wajib diisi." }, { status: 400 });
    }

    // Validasi format YYYY-MM
    const periodeRegex = /^\d{4}-\d{2}$/;
    if (!periodeRegex.test(periode)) {
      return NextResponse.json({ error: "Format periode harus YYYY-MM (contoh: 2026-09)." }, { status: 400 });
    }

    const [yearStr, monthStr] = periode.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "Bulan tidak valid (1-12)." }, { status: 400 });
    }

    // Buat tanggal 1 bulan tersebut di UTC (midnight)
    const periodeDate = new Date(Date.UTC(year, month - 1, 1));

    // Validasi: tidak boleh masa depan > 1 bulan dari bulan ini
    // Masa lalu (backfill) diperbolehkan tanpa batas
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const maxAllowedMonth = currentMonth + 1;
    const maxAllowedYear = maxAllowedMonth > 12 ? currentYear + 1 : currentYear;
    const maxAllowedMonthAdjusted = maxAllowedMonth > 12 ? 1 : maxAllowedMonth;

    if (year > maxAllowedYear || (year === maxAllowedYear && month > maxAllowedMonthAdjusted)) {
      return NextResponse.json(
        { error: "Periode tidak boleh lebih dari 1 bulan ke depan dari bulan berjalan." },
        { status: 400 }
      );
    }

    // Hitung batas awal & akhir bulan untuk query (UTC)
    const awalBulan = new Date(Date.UTC(year, month - 1, 1));
    const akhirBulan = new Date(Date.UTC(year, month, 1)); // 1 bulan berikutnya

    // Ambil semua karyawan AKTIF dengan tipePerhitunganGaji sudah di-set
    const karyawanList = await prisma.user.findMany({
      where: {
        status: "AKTIF",
        tipePerhitunganGaji: { not: null },
      },
      select: {
        id: true,
        kode: true,
        nama: true,
        tipePerhitunganGaji: true,
        tarifPerJam: true,
        gajiPokok: { select: { nominal: true } },
      },
    });

    if (karyawanList.length === 0) {
      return NextResponse.json({
        periode,
        totalKaryawan: 0,
        totalGenerated: 0,
        totalSkipped: 0,
        items: [],
      });
    }

    // Pre-fetch data untuk perhitungan batch
    const employeeIds = karyawanList.map((k) => k.id);

    // 1. Attendance: totalHariKerja (jumlah tanggalShift unik DIVERIFIKASI) dan totalMenitKerja (SUM).
    // Segmen PAM ganda di hari yang sama tetap dihitung 1 hari.
    const attendanceAgg = await prisma.attendance.groupBy({
      by: ["employeeId", "tanggalShift"],
      where: {
        employeeId: { in: employeeIds },
        tanggalShift: { gte: awalBulan, lt: akhirBulan },
        statusMasuk: "DIVERIFIKASI",
      },
      _sum: { totalMenitKerja: true, potongan: true },
    });

    // Map attendance data
    const attendanceMap = new Map<
      string,
      { totalHariKerja: number; totalMenitKerja: number; totalPotonganTelat: number }
    >();
    for (const a of attendanceAgg) {
      const cur = attendanceMap.get(a.employeeId) ?? {
        totalHariKerja: 0,
        totalMenitKerja: 0,
        totalPotonganTelat: 0,
      };
      cur.totalHariKerja += 1;
      cur.totalMenitKerja += a._sum.totalMenitKerja ?? 0;
      cur.totalPotonganTelat += a._sum.potongan ?? 0;
      attendanceMap.set(a.employeeId, cur);
    }

    // 2. Agenda: totalBonusAgenda (SUM nominal where status = DIVERIFIKASI, targetEmployeeId, diselesaikanPada di bulan)
    const agendaAgg = await prisma.agenda.groupBy({
      by: ["targetEmployeeId"],
      where: {
        targetEmployeeId: { in: employeeIds },
        status: "DIVERIFIKASI",
        diselesaikanPada: { gte: awalBulan, lt: akhirBulan },
        nominal: { not: null },
      },
      _sum: { nominal: true },
    });

    const agendaMap = new Map<string, number>();
    for (const a of agendaAgg) {
      if (a.targetEmployeeId) {
        agendaMap.set(a.targetEmployeeId, a._sum.nominal ?? 0);
      }
    }

    // Proses dalam transaction
    const results: PayrollItemResult[] = [];

    await prisma.$transaction(async (tx) => {
      const createdPayrolls: Array<{
        id: string;
        employeeId: string;
        periode: Date;
        gajiPokok: number;
        totalHariKerja: number | null;
        totalBonusAgenda: number;
        totalPotonganTelat: number;
        bonusManual: number;
        potonganManual: number;
        bonusPerforma: number;
        keteranganBonusPerforma: string | null;
        totalGaji: number;
        status: string;
      }> = [];

      for (const karyawan of karyawanList) {
        // Cek apakah payroll sudah ada untuk periode ini
        const existing = await tx.payroll.findUnique({
          where: {
            employeeId_periode: {
              employeeId: karyawan.id,
              periode: periodeDate,
            },
          },
        });

        if (existing) {
          results.push({
            employeeId: karyawan.id,
            employeeKode: karyawan.kode,
            employeeNama: karyawan.nama,
            gajiPokok: existing.gajiPokok,
            totalHariKerja: existing.totalHariKerja,
            totalBonusAgenda: existing.totalBonusAgenda,
            totalPotonganTelat: existing.totalPotonganTelat,
            bonusManual: existing.bonusManual,
            potonganManual: existing.potonganManual,
            bonusPerforma: existing.bonusPerforma,
            keteranganBonusPerforma: existing.keteranganBonusPerforma,
            totalGaji: existing.totalGaji,
            status: existing.status,
            action: "skipped",
          });
          continue;
        }

        // Ambil data agregat
        const att = attendanceMap.get(karyawan.id) ?? {
          totalHariKerja: 0,
          totalMenitKerja: 0,
          totalPotonganTelat: 0,
        };
        const totalBonusAgenda = agendaMap.get(karyawan.id) ?? 0;
        const gajiPokokNominal = karyawan.gajiPokok?.nominal ?? 0;

        // Hitung baseGaji berdasarkan tipePerhitunganGaji
        let baseGaji = 0;
        const tipe = karyawan.tipePerhitunganGaji!;

        if (tipe === "HARIAN") {
          // tarifPerJam × 8 × totalHariKerja
          const tarif = karyawan.tarifPerJam ?? 0;
          baseGaji = tarif * 8 * att.totalHariKerja;
        } else if (tipe === "BULANAN") {
          // gajiPokok dari tabel GajiPokok
          baseGaji = gajiPokokNominal;
        } else if (tipe === "JAM") {
          // tarifPerJam × floor(totalMenitKerja / 60)
          const tarif = karyawan.tarifPerJam ?? 0;
          const jamKerja = Math.floor(att.totalMenitKerja / 60);
          baseGaji = tarif * jamKerja;
        }

        // Komponen manual & performa = 0 saat generate awal
        const bonusManual = 0;
        const potonganManual = 0;
        const bonusPerforma = 0;
        const keteranganBonusPerforma = null;

        // Total gaji
        const totalGaji =
          baseGaji +
          totalBonusAgenda +
          bonusManual +
          bonusPerforma -
          att.totalPotonganTelat -
          potonganManual;

        // Create payroll
        const payroll = await tx.payroll.create({
          data: {
            employeeId: karyawan.id,
            periode: periodeDate,
            gajiPokok: gajiPokokNominal,
            totalHariKerja: tipe === "HARIAN" ? att.totalHariKerja : null,
            totalBonusAgenda,
            totalPotonganTelat: att.totalPotonganTelat,
            bonusManual,
            potonganManual,
            bonusPerforma,
            keteranganBonusPerforma,
            totalGaji,
            status: "DRAFT",
          },
        });

        results.push({
          employeeId: karyawan.id,
          employeeKode: karyawan.kode,
          employeeNama: karyawan.nama,
          gajiPokok: payroll.gajiPokok,
          totalHariKerja: payroll.totalHariKerja,
          totalBonusAgenda: payroll.totalBonusAgenda,
          totalPotonganTelat: payroll.totalPotonganTelat,
          bonusManual: payroll.bonusManual,
          potonganManual: payroll.potonganManual,
          bonusPerforma: payroll.bonusPerforma,
          keteranganBonusPerforma: payroll.keteranganBonusPerforma,
          totalGaji: payroll.totalGaji,
          status: payroll.status,
          action: "created",
        });

        // Collect for audit log
        createdPayrolls.push(payroll);
      }

    // Batch create audit logs inline
    if (createdPayrolls.length > 0) {
      await tx.auditLog.createMany({
        data: createdPayrolls.map((p) => ({
          tabel: "Payroll",
          recordId: p.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: p.id,
            employeeId: p.employeeId,
            periode: p.periode.toISOString(),
            gajiPokok: p.gajiPokok,
            totalHariKerja: p.totalHariKerja,
            totalBonusAgenda: p.totalBonusAgenda,
            totalPotonganTelat: p.totalPotonganTelat,
            bonusManual: p.bonusManual,
            potonganManual: p.potonganManual,
            bonusPerforma: p.bonusPerforma,
            keteranganBonusPerforma: p.keteranganBonusPerforma,
            totalGaji: p.totalGaji,
            status: p.status,
          },
          actorId: session.user.id,
        })),
      });
    }
  });

    const totalGenerated = results.filter((r) => r.action === "created").length;
    const totalSkipped = results.filter((r) => r.action === "skipped").length;

    return NextResponse.json({
      periode,
      totalKaryawan: karyawanList.length,
      totalGenerated,
      totalSkipped,
      items: results,
    });
  } catch (err) {
    console.error("POST /api/payroll/generate error:", err);
    return NextResponse.json({ error: "Gagal generate payroll." }, { status: 500 });
  }
}