import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];
const POTONGAN_PER_MENIT = 1000;
const MENIT_TELAT_MAX = 1440;

type Bagian = "masuk" | "keluar";
type Action = "approve" | "reject";

type Body = {
  bagian?: unknown;
  action?: unknown;
  reason?: unknown;
  menitTelat?: unknown;
  isPam?: unknown;
};

// PATCH /api/absensi/[id]/verify
// Body: { bagian: "masuk" | "keluar", action: "approve" | "reject", reason?: string }
export async function PATCH(
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
        { error: "Role Anda tidak berwenang memverifikasi absensi." },
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

    const bagian = body.bagian;
    if (bagian !== "masuk" && bagian !== "keluar") {
      return NextResponse.json(
        { error: "Field 'bagian' harus 'masuk' atau 'keluar'" },
        { status: 400 }
      );
    }

    const action = body.action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Field 'action' harus 'approve' atau 'reject'" },
        { status: 400 }
      );
    }

    let reason: string | null = null;
    if (action === "reject") {
      if (typeof body.reason !== "string" || body.reason.trim().length < 3) {
        return NextResponse.json(
          { error: "Alasan penolakan wajib diisi, minimal 3 karakter." },
          { status: 400 }
        );
      }
      reason = body.reason.trim();
    }

    let menitTelat = 0;
    let isPam = false;

    if (bagian === "masuk" && action === "approve") {
      if (
        typeof body.menitTelat !== "number" ||
        !Number.isInteger(body.menitTelat) ||
        body.menitTelat < 0 ||
        body.menitTelat > MENIT_TELAT_MAX
      ) {
        return NextResponse.json(
          {
            error: `Field 'menitTelat' wajib diisi untuk approve absen masuk (integer 0-${MENIT_TELAT_MAX}).`,
          },
          { status: 400 }
        );
      }
      menitTelat = body.menitTelat;

      if (body.isPam !== undefined) {
        if (typeof body.isPam !== "boolean") {
          return NextResponse.json(
            { error: "Field 'isPam' harus boolean bila diisi." },
            { status: 400 }
          );
        }
        isPam = body.isPam;
      }
    }

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: {
        logs: {
          where: { jenis: bagian === "masuk" ? "MASUK" : "KELUAR" },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!attendance) {
      return NextResponse.json({ error: "Absensi tidak ditemukan." }, { status: 404 });
    }

    if (attendance.employeeId === session.user.id) {
      return NextResponse.json(
        { error: "Tidak boleh memverifikasi absensi sendiri." },
        { status: 403 }
      );
    }

    if (bagian === "keluar" && attendance.absenKeluar === null) {
      return NextResponse.json(
        { error: "Absensi belum check-out. Tidak bisa diverifikasi." },
        { status: 409 }
      );
    }

    const targetLog = attendance.logs[0];
    if (!targetLog) {
      return NextResponse.json(
        { error: `Belum ada log absen ${bagian}.` },
        { status: 404 }
      );
    }

    if (targetLog.status !== "PENDING_VERIFIKASI") {
      return NextResponse.json(
        { error: `Absen ${bagian} ini sudah diverifikasi sebelumnya.` },
        { status: 409 }
      );
    }

    const now = new Date();

    const nilaiSebelum = {
      id: attendance.id,
      employeeId: attendance.employeeId,
      storeId: attendance.storeId,
      statusMasuk: attendance.statusMasuk,
      statusKeluar: attendance.statusKeluar,
      menitTelat: attendance.menitTelat,
      potongan: attendance.potongan,
      isPam: attendance.isPam,
      logs: attendance.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        status: l.status,
        verifiedById: l.verifiedById,
        verifiedAt: l.verifiedAt?.toISOString() ?? null,
        rejectedReason: l.rejectedReason,
      })),
    };

    const result = await prisma.$transaction(async (tx) => {
      const updatedLog = await tx.attendanceLog.update({
        where: { id: targetLog.id },
        data:
          action === "approve"
            ? {
                status: "DIVERIFIKASI",
                verifiedById: session.user.id,
                verifiedAt: now,
                rejectedReason: null,
              }
            : {
                status: "DITOLAK",
                verifiedById: session.user.id,
                verifiedAt: now,
                rejectedReason: reason,
              },
      });

      const statusField = bagian === "masuk" ? "statusMasuk" : "statusKeluar";
      let updatedAttendance = await tx.attendance.update({
        where: { id },
        data: { [statusField]: updatedLog.status },
      });

      if (bagian === "masuk" && action === "approve") {
        const potongan = menitTelat * POTONGAN_PER_MENIT;
        updatedAttendance = await tx.attendance.update({
          where: { id },
          data: { menitTelat, potongan, isPam },
        });
      }

      const nilaiSesudah = {
        id: updatedAttendance.id,
        employeeId: updatedAttendance.employeeId,
        storeId: updatedAttendance.storeId,
        statusMasuk: updatedAttendance.statusMasuk,
        statusKeluar: updatedAttendance.statusKeluar,
        menitTelat: updatedAttendance.menitTelat,
        potongan: updatedAttendance.potongan,
        isPam: updatedAttendance.isPam,
      };

      await tx.auditLog.create({
        data: {
          tabel: "Attendance",
          recordId: updatedAttendance.id,
          aksi: "UPDATE",
          nilaiSebelum,
          nilaiSesudah,
          actorId: session.user.id,
          alasan: action === "reject" ? reason : undefined,
        },
      });

      return { updatedAttendance, updatedLog };
    });

    return NextResponse.json({
      attendanceId: result.updatedAttendance.id,
      bagian,
      statusMasuk: result.updatedAttendance.statusMasuk,
      statusKeluar: result.updatedAttendance.statusKeluar,
      menitTelat: result.updatedAttendance.menitTelat,
      potongan: result.updatedAttendance.potongan,
      isPam: result.updatedAttendance.isPam,
      log: {
        id: result.updatedLog.id,
        jenis: result.updatedLog.jenis,
        status: result.updatedLog.status,
        verifiedById: result.updatedLog.verifiedById,
        verifiedAt: result.updatedLog.verifiedAt ? result.updatedLog.verifiedAt.toISOString() : null,
        rejectedReason: result.updatedLog.rejectedReason,
      },
    });
  } catch (err) {
    console.error("PATCH /api/absensi/[id]/verify error:", err);
    return NextResponse.json(
      { error: "Gagal memproses verifikasi. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
