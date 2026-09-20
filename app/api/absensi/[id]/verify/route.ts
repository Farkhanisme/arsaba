import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];

type Bagian = "masuk" | "keluar";
type Action = "approve" | "reject";

type Body = {
  bagian?: unknown;
  action?: unknown;
  reason?: unknown;
};

// PATCH /api/absensi/[id]/verify
// Body: { bagian: "masuk" | "keluar", action: "approve" | "reject", reason?: string }
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

    const updatedLog = await prisma.attendanceLog.update({
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
    const updatedAttendance = await prisma.attendance.update({
      where: { id },
      data: { [statusField]: updatedLog.status },
    });

    return NextResponse.json({
      attendanceId: updatedAttendance.id,
      bagian,
      statusMasuk: updatedAttendance.statusMasuk,
      statusKeluar: updatedAttendance.statusKeluar,
      log: {
        id: updatedLog.id,
        jenis: updatedLog.jenis,
        status: updatedLog.status,
        verifiedById: updatedLog.verifiedById,
        verifiedAt: updatedLog.verifiedAt ? updatedLog.verifiedAt.toISOString() : null,
        rejectedReason: updatedLog.rejectedReason,
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
