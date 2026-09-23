import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["MANAJER"];

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
        { error: "Hanya MANAJER yang boleh lock payroll." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const existing = await prisma.payroll.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Payroll tidak ditemukan." }, { status: 404 });
    }

    if (existing.status === "LOCKED") {
      return NextResponse.json({ error: "Payroll sudah di-lock sebelumnya." }, { status: 409 });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Simpan nilai sebelum untuk audit
      const nilaiSebelum = {
        id: existing.id,
        status: existing.status,
        lockedAt: existing.lockedAt,
        lockedById: existing.lockedById,
      };

      const updated = await tx.payroll.update({
        where: { id },
        data: {
          status: "LOCKED",
          lockedAt: now,
          lockedById: session.user.id,
        },
      });

      const nilaiSesudah = {
        id: updated.id,
        status: updated.status,
        lockedAt: updated.lockedAt,
        lockedById: updated.lockedById,
      };

      await tx.auditLog.create({
        data: {
          tabel: "Payroll",
          recordId: updated.id,
          aksi: "UPDATE",
          nilaiSebelum,
          nilaiSesudah,
          actorId: session.user.id,
          alasan: "Payroll di-lock (finalisasi)",
        },
      });

      return updated;
    });

    return NextResponse.json({
      id: result.id,
      status: result.status,
      lockedAt: result.lockedAt?.toISOString() ?? null,
      lockedById: result.lockedById ?? null,
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/payroll/[id]/lock error:", err);
    return NextResponse.json({ error: "Gagal lock payroll." }, { status: 500 });
  }
}