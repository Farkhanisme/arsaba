import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  MENIT_PER_HARI,
  menitEfektif,
  jamTerbayarDariMenit,
  payrollLocked,
  pesanPayrollLocked,
} from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["SUPERVISOR", "ADMIN", "MANAJER"];
const MIN_ALASAN = 5;

type Body = {
  totalMenitManual?: unknown;
  alasan?: unknown;
};

/**
 * POST /api/absensi/[id]/koreksi-jam
 * Body: { totalMenitManual: number | null, alasan: string }
 *
 * Koreksi jam kerja manual — KHUSUS karyawan tipe `JAM` (spesifikasi §7.1a).
 *
 * Kapan dipakai: sistem mencatat 7 jam 50 menit, Manajer ingin membulatkan
 * jadi 8 jam (atau sebaliknya). Berlaku naik maupun turun, TANPA batas
 * terhadap durasi shift — hanya batas fisik 0..1440 menit.
 *
 * Yang TIDAK boleh:
 *   - Karyawan tipe HARIAN / BULANAN. Untuk HARIAN yang dihitung "berapa kali
 *     berangkat", jam kerja tidak berpengaruh sama sekali; untuk BULANAN
 *     nominalnya tetap. Jadi return 400.
 *   - Saat payroll bulan itu sudah LOCKED — payslip sudah final, harus lewat
 *     mekanisme revisi (§7.1b) supaya angkanya tetap konsisten.
 *   - Pada hari izin / tanpa kehadiran — hari itu tidak punya record
 *     Attendance sama sekali.
 *
 * `Attendance.totalMenitKerja` TIDAK diubah — nilai server asli tetap
 * tersimpan supaya perbandingannya selalu terlihat di rincian per hari.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Tidak berwenang mengoreksi jam kerja." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    // `null` berarti BATALKAN koreksi (kembali ke hitungan server) — tetap butuh
    // alasan karena ini perubahan angka yang sudah tercatat.
    const bolehReset = body.totalMenitManual === null;
    const nilai = body.totalMenitManual;
    if (!bolehReset && (typeof nilai !== "number" || !Number.isInteger(nilai))) {
      return NextResponse.json(
        { error: "Field 'totalMenitManual' wajib integer, atau null untuk membatalkan koreksi." },
        { status: 400 }
      );
    }
    if (typeof nilai === "number" && (nilai < 0 || nilai > MENIT_PER_HARI)) {
      return NextResponse.json(
        {
          error: `Field 'totalMenitManual' harus 0-${MENIT_PER_HARI} menit.`,
        },
        { status: 400 }
      );
    }

    const alasan = typeof body.alasan === "string" ? body.alasan.trim() : "";
    if (alasan.length < MIN_ALASAN) {
      return NextResponse.json(
        { error: `Field 'alasan' wajib diisi, minimal ${MIN_ALASAN} karakter.` },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        tanggalShift: true,
        totalMenitKerja: true,
        totalMenitManual: true,
      },
    });
    if (!attendance) {
      return NextResponse.json(
        { error: "Absensi tidak ditemukan." },
        { status: 404 }
      );
    }

    // Tidak boleh mengoreksi absensi sendiri — sama seperti verifikasi.
    if (attendance.employeeId === session.user.id) {
      return NextResponse.json(
        { error: "Tidak boleh mengoreksi jam kerja absensi sendiri." },
        { status: 403 }
      );
    }

    // Hanya tipe JAM. Ini yang menjamin HARIAN & BULANAN tidak tersentuh.
    const employee = await prisma.user.findUnique({
      where: { id: attendance.employeeId },
      select: { tipePerhitunganGaji: true },
    });
    if (employee?.tipePerhitunganGaji !== "JAM") {
      return NextResponse.json(
        {
          error: `Koreksi jam hanya untuk karyawan tipe JAM. Tipe karyawan ini: ${employee?.tipePerhitunganGaji ?? "belum ditentukan"}.`,
        },
        { status: 400 }
      );
    }

    // Payroll bulan yang sama sudah LOCKED -> wajib lewat mekanisme revisi.
    if (await payrollLocked(prisma, attendance.employeeId, attendance.tanggalShift)) {
      return NextResponse.json(
        { error: pesanPayrollLocked(attendance.tanggalShift) },
        { status: 409 }
      );
    }

    const totalMenitManual = bolehReset ? null : (nilai as number);
    const now = new Date();

    const hasil = await prisma.$transaction(async (tx) => {
      const updated = await tx.attendance.update({
        where: { id },
        data: {
          totalMenitManual,
          koreksiJamAlasan: alasan,
          koreksiJamOlehId: session.user.id,
          koreksiJamPada: now,
        },
        select: { totalMenitKerja: true, totalMenitManual: true },
      });

      await tx.auditLog.create({
        data: {
          tabel: "Attendance",
          recordId: id,
          aksi: "UPDATE",
          nilaiSebelum: {
            totalMenitKerja: attendance.totalMenitKerja,
            totalMenitManual: attendance.totalMenitManual,
          },
          nilaiSesudah: {
            totalMenitKerja: updated.totalMenitKerja,
            totalMenitManual: updated.totalMenitManual,
          },
          actorId: session.user.id,
          alasan,
        },
      });

      return updated;
    });

    const menitFinal = menitEfektif({
      totalMenitKerja: hasil.totalMenitKerja,
      totalMenitManual: hasil.totalMenitManual,
    });

    return NextResponse.json({
      id,
      totalMenitKerja: hasil.totalMenitKerja,
      totalMenitManual: hasil.totalMenitManual,
      menitEfektif: menitFinal,
      jamDibayar: jamTerbayarDariMenit(menitFinal),
    });
  } catch (err) {
    console.error("POST /api/absensi/[id]/koreksi-jam error:", err);
    return NextResponse.json(
      { error: "Gagal mengoreksi jam kerja." },
      { status: 500 }
    );
  }
}
