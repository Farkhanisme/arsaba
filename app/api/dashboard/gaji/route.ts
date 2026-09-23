import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const CROSS_STORE_ROLES: Role[] = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];
const PERSONAL_ROLES: Role[] = ["KARYAWAN", "KEPALA_TOKO"];

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role as Role;

    const { searchParams } = new URL(request.url);
    const periodeParam = searchParams.get("periode"); // "YYYY-MM"

    // Default ke bulan berjalan (WIB)
    const now = new Date();
    const wibOffset = 7 * 60 * 60 * 1000;
    const wibNow = new Date(now.getTime() + wibOffset);
    const defaultYear = wibNow.getUTCFullYear();
    const defaultMonth = wibNow.getUTCMonth() + 1;
    const periode = periodeParam ?? `${defaultYear}-${String(defaultMonth).padStart(2, "0")}`;

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

    // Batas awal & akhir bulan (UTC)
    const awalBulan = new Date(Date.UTC(year, month - 1, 1));
    const akhirBulan = new Date(Date.UTC(year, month, 1));

    // Helper: hitung baseGaji
    function hitungBaseGaji(
      tipe: string | null,
      tarifPerJam: number | null,
      gajiPokokNominal: number,
      totalHariKerja: number,
      totalMenitKerja: number
    ): number {
      if (tipe === "HARIAN") {
        return (tarifPerJam ?? 0) * 8 * totalHariKerja;
      } else if (tipe === "BULANAN") {
        return gajiPokokNominal;
      } else if (tipe === "JAM") {
        return (tarifPerJam ?? 0) * Math.floor(totalMenitKerja / 60);
      }
      return 0;
    }

    if (CROSS_STORE_ROLES.includes(userRole)) {
      // ==================== CROSS-STORE VIEW (Direktur/Manajer/Admin/Supervisor) ====================
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
          role: true,
          tipePerhitunganGaji: true,
          tarifPerJam: true,
          storeId: true,
          store: { select: { id: true, nama: true } },
          gajiPokok: { select: { nominal: true } },
        },
        orderBy: [{ store: { nama: "asc" } }, { nama: "asc" }],
      });

      if (karyawanList.length === 0) {
        return NextResponse.json({
          periode,
          role: userRole,
          view: "cross-store",
          totalEstimasiPayroll: 0,
          totalKaryawan: 0,
          stores: [],
        });
      }

      const employeeIds = karyawanList.map((k) => k.id);

      // 1. Attendance agregat per karyawan
      const attendanceAgg = await prisma.attendance.groupBy({
        by: ["employeeId"],
        where: {
          employeeId: { in: employeeIds },
          tanggalShift: { gte: awalBulan, lt: akhirBulan },
          statusMasuk: "DIVERIFIKASI",
        },
        _count: { id: true },
        _sum: { totalMenitKerja: true, potongan: true },
      });

      const attendanceMap = new Map<
        string,
        { totalHariKerja: number; totalMenitKerja: number; totalPotonganTelat: number }
      >();
      for (const a of attendanceAgg) {
        attendanceMap.set(a.employeeId, {
          totalHariKerja: a._count.id,
          totalMenitKerja: a._sum.totalMenitKerja ?? 0,
          totalPotonganTelat: a._sum.potongan ?? 0,
        });
      }

      // 2. Agenda agregat per karyawan
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

      // Build response grouped by store
      const storeMap = new Map<
        string,
        { storeId: string; storeNama: string; totalEstimasi: number; jumlahKaryawan: number; karyawan: any[] }
      >();

      let totalEstimasiPayroll = 0;

      for (const karyawan of karyawanList) {
        const att = attendanceMap.get(karyawan.id) ?? {
          totalHariKerja: 0,
          totalMenitKerja: 0,
          totalPotonganTelat: 0,
        };
        const totalBonusAgenda = agendaMap.get(karyawan.id) ?? 0;
        const gajiPokokNominal = karyawan.gajiPokok?.nominal ?? 0;

        const baseGaji = hitungBaseGaji(
          karyawan.tipePerhitunganGaji,
          karyawan.tarifPerJam,
          gajiPokokNominal,
          att.totalHariKerja,
          att.totalMenitKerja
        );

        const estimasiGaji = baseGaji + totalBonusAgenda - att.totalPotonganTelat;
        totalEstimasiPayroll += estimasiGaji;

        const storeId = karyawan.storeId ?? "tanpa-toko";
        const storeNama = karyawan.store?.nama ?? "Tanpa Toko";

        if (!storeMap.has(storeId)) {
          storeMap.set(storeId, {
            storeId,
            storeNama,
            totalEstimasi: 0,
            jumlahKaryawan: 0,
            karyawan: [],
          });
        }

        const storeData = storeMap.get(storeId)!;
        storeData.totalEstimasi += estimasiGaji;
        storeData.jumlahKaryawan += 1;
        storeData.karyawan.push({
          employeeId: karyawan.id,
          kode: karyawan.kode,
          nama: karyawan.nama,
          tipePerhitunganGaji: karyawan.tipePerhitunganGaji,
          baseGaji,
          totalHariKerja: att.totalHariKerja,
          totalMenitKerja: att.totalMenitKerja,
          totalBonusAgenda,
          totalPotonganTelat: att.totalPotonganTelat,
          estimasiGaji,
        });
      }

      const stores = Array.from(storeMap.values()).sort((a, b) => a.storeNama.localeCompare(b.storeNama));

      return NextResponse.json({
        periode,
        role: userRole,
        view: "cross-store",
        totalEstimasiPayroll,
        totalKaryawan: karyawanList.length,
        stores,
      });
    } else if (PERSONAL_ROLES.includes(userRole)) {
      // ==================== PERSONAL VIEW (Karyawan/Kepala Toko) ====================
      const karyawan = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          kode: true,
          nama: true,
          role: true,
          tipePerhitunganGaji: true,
          tarifPerJam: true,
          storeId: true,
          store: { select: { id: true, nama: true } },
          gajiPokok: { select: { nominal: true } },
        },
      });

      if (!karyawan) {
        return NextResponse.json({ error: "Karyawan tidak ditemukan." }, { status: 404 });
      }

      if (!karyawan.tipePerhitunganGaji) {
        return NextResponse.json({
          periode,
          role: userRole,
          view: "personal",
          karyawan: null,
          message: "Tipe perhitungan gaji belum diatur. Hubungi Manajer.",
        });
      }

      // Attendance
      const attendanceAgg = await prisma.attendance.groupBy({
        by: ["employeeId"],
        where: {
          employeeId: userId,
          tanggalShift: { gte: awalBulan, lt: akhirBulan },
          statusMasuk: "DIVERIFIKASI",
        },
        _count: { id: true },
        _sum: { totalMenitKerja: true, potongan: true },
      });

      const att = attendanceAgg[0] ?? {
        _count: { id: 0 },
        _sum: { totalMenitKerja: 0, potongan: 0 },
      };
      const totalHariKerja = att._count.id;
      const totalMenitKerja = att._sum.totalMenitKerja ?? 0;
      const totalPotonganTelat = att._sum.potongan ?? 0;

      // Agenda
      const agendaAgg = await prisma.agenda.groupBy({
        by: ["targetEmployeeId"],
        where: {
          targetEmployeeId: userId,
          status: "DIVERIFIKASI",
          diselesaikanPada: { gte: awalBulan, lt: akhirBulan },
          nominal: { not: null },
        },
        _sum: { nominal: true },
      });

      const totalBonusAgenda = agendaAgg[0]?._sum.nominal ?? 0;
      const gajiPokokNominal = karyawan.gajiPokok?.nominal ?? 0;

      const baseGaji = hitungBaseGaji(
        karyawan.tipePerhitunganGaji,
        karyawan.tarifPerJam,
        gajiPokokNominal,
        totalHariKerja,
        totalMenitKerja
      );

      const estimasiGaji = baseGaji + totalBonusAgenda - totalPotonganTelat;

      return NextResponse.json({
        periode,
        role: userRole,
        view: "personal",
        karyawan: {
          employeeId: karyawan.id,
          kode: karyawan.kode,
          nama: karyawan.nama,
          storeNama: karyawan.store?.nama ?? "—",
          tipePerhitunganGaji: karyawan.tipePerhitunganGaji,
          baseGaji,
          totalHariKerja,
          totalMenitKerja,
          totalBonusAgenda,
          totalPotonganTelat,
          estimasiGaji,
        },
      });
    } else {
      return NextResponse.json({ error: "Role tidak dikenali." }, { status: 403 });
    }
  } catch (err) {
    console.error("GET /api/dashboard/gaji error:", err);
    return NextResponse.json({ error: "Gagal mengambil data estimasi gaji." }, { status: 500 });
  }
}