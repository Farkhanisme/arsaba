import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];

type Body = {
  absenKeluar?: unknown;
  keterangan?: unknown;
};

// PATCH /api/absensi/[id]/override-keluar
// Body: { absenKeluar: ISO string, keterangan: string }
// Dipakai untuk: karyawan lupa check-out, atau admin menyelesaikan shift yang
// absen keluarnya bermasalah dan tidak bisa diselesaikan karyawan.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengoreksi absen keluar." },
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

    if (typeof body.absenKeluar !== "string") {
      return NextResponse.json(
        { error: "Field 'absenKeluar' wajib diisi (ISO datetime)." },
        { status: 400 }
      );
    }
    const absenKeluar = new Date(body.absenKeluar);
    if (Number.isNaN(absenKeluar.getTime())) {
      return NextResponse.json(
        { error: "Format 'absenKeluar' tidak valid (harus ISO datetime)." },
        { status: 400 }
      );
    }

    if (typeof body.keterangan !== "string" || body.keterangan.trim().length < 3) {
      return NextResponse.json(
        { error: "Field 'keterangan' wajib diisi, minimal 3 karakter." },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.findUnique({ where: { id } });
    if (!attendance) {
      return NextResponse.json({ error: "Absensi tidak ditemukan." }, { status: 404 });
    }

    if (attendance.employeeId === session.user.id) {
      return NextResponse.json(
        { error: "Tidak boleh mengoreksi absensi sendiri." },
        { status: 403 }
      );
    }

    if (attendance.absenKeluar !== null) {
      return NextResponse.json(
        { error: "Absen keluar sudah ada, tidak bisa di-override." },
        { status: 409 }
      );
    }

    const now = new Date();
    const totalMenitKerja = Math.max(
      0,
      Math.floor((absenKeluar.getTime() - attendance.absenMasuk.getTime()) / 60000)
    );

    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        absenKeluar,
        fotoKeluarDiambilPada: now,
        statusKeluar: "DIVERIFIKASI",
        totalMenitKerja,
        logs: {
          create: {
            jenis: "KELUAR",
            absenServerPada: absenKeluar,
            status: "DIVERIFIKASI",
            verifiedById: session.user.id,
            verifiedAt: now,
            keteranganKoreksi: body.keterangan.trim(),
            isOverride: true,
          },
        },
      },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({
      id: updated.id,
      statusMasuk: updated.statusMasuk,
      statusKeluar: updated.statusKeluar,
      totalMenitKerja: updated.totalMenitKerja,
      absenMasuk: updated.absenMasuk.toISOString(),
      absenKeluar: updated.absenKeluar ? updated.absenKeluar.toISOString() : null,
      fotoKeluarDiambilPada: updated.fotoKeluarDiambilPada
        ? updated.fotoKeluarDiambilPada.toISOString()
        : null,
      logs: updated.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        status: l.status,
        absenServerPada: l.absenServerPada.toISOString(),
        isOverride: l.isOverride,
        keteranganKoreksi: l.keteranganKoreksi,
        verifiedById: l.verifiedById,
      })),
    });
  } catch (err) {
    console.error("PATCH /api/absensi/[id]/override-keluar error:", err);
    return NextResponse.json(
      { error: "Gagal memproses override. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
