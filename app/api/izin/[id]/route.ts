import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const MARK_ROLES: Role[] = ["MANAJER", "ADMIN", "SUPERVISOR"];
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// DELETE /api/izin/[id] — batalkan penandaan izin.
// Hanya bisa dibatalkan jika tanggal izin belum lewat (WIB).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!MARK_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json(
        { error: "Hanya Manajer, Admin, atau Supervisor yang dapat membatalkan izin." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const izin = await prisma.izin.findUnique({ where: { id } });
    if (!izin) {
      return NextResponse.json(
        { error: "Data izin tidak ditemukan." },
        { status: 404 }
      );
    }

    // Hari ini dalam WIB (date-only).
    const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
    const hariIniWIB = new Date(
      Date.UTC(
        wibNow.getUTCFullYear(),
        wibNow.getUTCMonth(),
        wibNow.getUTCDate()
      )
    );
    if (izin.tanggal.getTime() < hariIniWIB.getTime()) {
      return NextResponse.json(
        { error: "Izin yang tanggalnya sudah lewat tidak dapat dibatalkan." },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.izin.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tabel: "Izin",
          recordId: id,
          aksi: "DELETE",
          nilaiSebelum: {
            id: izin.id,
            employeeId: izin.employeeId,
            tanggal: izin.tanggal.toISOString(),
            alasan: izin.alasan,
          },
          actorId: session.user.id,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/izin/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal membatalkan izin. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
