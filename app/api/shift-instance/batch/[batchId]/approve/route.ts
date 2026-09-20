import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cariDanHitungUntukCheckIn } from "@/lib/absensi";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

// PATCH /api/shift-instance/batch/[batchId]/approve
// Approve semua ShiftInstance dalam batch yang masih DRAFT.
// Yang sudah APPROVED di-skip (tidak di-overwrite, jejak audit terjaga).
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang approve batch." },
        { status: 403 }
      );
    }

    const { batchId } = await params;
    if (!batchId || batchId.length < 8) {
      return NextResponse.json({ error: "batchId tidak valid" }, { status: 400 });
    }

    const total = await prisma.shiftInstance.count({ where: { batchId } });
    if (total === 0) {
      return NextResponse.json(
        { error: "Batch tidak ditemukan." },
        { status: 404 }
      );
    }

    const draftInstances = await prisma.shiftInstance.findMany({
      where: { batchId, statusJadwal: "DRAFT" },
      select: { id: true, tanggal: true },
    });

    const now = new Date();
    const result = await prisma.shiftInstance.updateMany({
      where: { batchId, statusJadwal: "DRAFT" },
      data: {
        statusJadwal: "APPROVED",
        approvedById: session.user.id,
        approvedAt: now,
      },
    });

    const approved = result.count;
    const skipped = total - approved;

    // Recompute attendances for newly approved instances
    let recomputed = 0;
    if (draftInstances.length > 0) {
      for (const inst of draftInstances) {
        const assignments = await prisma.shiftAssignment.findMany({
          where: { shiftInstanceId: inst.id },
          select: { employeeId: true },
        });
        const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
        if (employeeIds.length === 0) continue;

        const attendances = await prisma.attendance.findMany({
          where: {
            employeeId: { in: employeeIds },
            tanggalShift: inst.tanggal,
          },
          select: {
            id: true,
            employeeId: true,
            absenMasuk: true,
            tanggalShift: true,
          },
        });

        for (const att of attendances) {
          const hasil = await cariDanHitungUntukCheckIn(
            att.employeeId,
            att.absenMasuk,
            att.tanggalShift
          );
          await prisma.attendance.update({
            where: { id: att.id },
            data: {
              shiftMulai: hasil.shiftMulai,
              shiftSelesai: hasil.shiftSelesai,
              menitTelat: hasil.menitTelat,
              potongan: hasil.potongan,
            },
          });
          recomputed++;
        }
      }
    }

    return NextResponse.json({
      batchId,
      total,
      approved,
      skipped,
      recomputed,
    });
  } catch (err) {
    console.error("PATCH /api/shift-instance/batch/[batchId]/approve error:", err);
    return NextResponse.json(
      { error: "Gagal approve batch." },
      { status: 500 }
    );
  }
}
