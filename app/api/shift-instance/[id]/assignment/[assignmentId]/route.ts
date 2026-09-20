import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

// DELETE /api/shift-instance/[id]/assignment/[assignmentId]
// Menghapus assignment. Kalau instance APPROVED, otomatis reset ke DRAFT.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengubah assignment." },
        { status: 403 }
      );
    }

    const { id, assignmentId } = await params;

    const existing = await prisma.shiftAssignment.findFirst({
      where: { id: assignmentId, shiftInstanceId: id },
      include: { shiftInstance: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Assignment tidak ditemukan." },
        { status: 404 }
      );
    }

    // Kumpulkan semua employeeId di instance ini (termasuk yang akan dihapus)
    const semuaAssignment = await prisma.shiftAssignment.findMany({
      where: { shiftInstanceId: id },
      select: { employeeId: true },
    });
    const employeeIdsReset = [
      ...new Set(semuaAssignment.map((a) => a.employeeId)),
    ];

    await prisma.shiftAssignment.delete({ where: { id: assignmentId } });

    let statusInstance: "DRAFT" | "APPROVED" =
      existing.shiftInstance.statusJadwal;
    if (existing.shiftInstance.statusJadwal === "APPROVED") {
      await prisma.shiftInstance.update({
        where: { id },
        data: {
          statusJadwal: "DRAFT",
          approvedById: null,
          approvedAt: null,
        },
      });

      if (employeeIdsReset.length > 0) {
        await prisma.attendance.updateMany({
          where: {
            employeeId: { in: employeeIdsReset },
            tanggalShift: existing.shiftInstance.tanggal,
          },
          data: {
            shiftMulai: null,
            shiftSelesai: null,
            menitTelat: 0,
            potongan: 0,
          },
        });
      }

      statusInstance = "DRAFT";
    }

    return NextResponse.json({
      deleted: true,
      id: assignmentId,
      instanceStatusBaru: statusInstance,
    });
  } catch (err) {
    console.error(
      "DELETE /api/shift-instance/[id]/assignment/[assignmentId] error:",
      err
    );
    return NextResponse.json(
      { error: "Gagal menghapus assignment." },
      { status: 500 }
    );
  }
}
