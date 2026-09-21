import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

// POST /api/agenda/[id]/selesai
// Karyawan tandai agenda selesai: upload bukti fotoBefore/fotoAfter (opsional) + set diselesaikanPada.
// Body: multipart/form-data, field 'fotoBefore' (File, opsional), 'fotoAfter' (File, opsional).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { id } = await params;

    const formData = await request.formData();
    const fotoBefore = formData.get("fotoBefore") as File | null;
    const fotoAfter = formData.get("fotoAfter") as File | null;

    const agenda = await prisma.agenda.findUnique({
      where: { id },
      select: {
        id: true,
        targetEmployeeId: true,
        status: true,
        diselesaikanPada: true,
      },
    });

    if (!agenda) {
      return NextResponse.json(
        { error: "Agenda tidak ditemukan." },
        { status: 404 }
      );
    }

    if (agenda.targetEmployeeId !== session.user.id) {
      return NextResponse.json(
        { error: "Agenda ini bukan milik Anda." },
        { status: 403 }
      );
    }

    if (agenda.status !== "PENDING_VERIFIKASI") {
      return NextResponse.json(
        { error: "Agenda ini sudah diverifikasi atau ditolak." },
        { status: 409 }
      );
    }

    if (agenda.diselesaikanPada !== null) {
      return NextResponse.json(
        { error: "Agenda ini sudah ditandai selesai sebelumnya." },
        { status: 409 }
      );
    }

    let buktiBeforeFileId: string | null = null;
    let buktiAfterFileId: string | null = null;

    if (fotoBefore) {
      const beforeBuf = Buffer.from(await fotoBefore.arrayBuffer());
      const beforeName =
        fotoBefore.name || `agenda-sebelum-${Date.now()}.jpg`;
      const beforeResult = await uploadToTelegram(beforeBuf, beforeName, {
        asDocument: false,
      });
      buktiBeforeFileId = beforeResult.fileId;
    }

    if (fotoAfter) {
      const afterBuf = Buffer.from(await fotoAfter.arrayBuffer());
      const afterName =
        fotoAfter.name || `agenda-sesudah-${Date.now()}.jpg`;
      const afterResult = await uploadToTelegram(afterBuf, afterName, {
        asDocument: false,
      });
      buktiAfterFileId = afterResult.fileId;
    }

    const now = new Date();
    const updated = await prisma.agenda.update({
      where: { id },
      data: {
        buktiBeforeFileId,
        buktiAfterFileId,
        diselesaikanPada: now,
      },
    });

    return NextResponse.json({
      id: updated.id,
      buktiBeforeFileId: updated.buktiBeforeFileId,
      buktiAfterFileId: updated.buktiAfterFileId,
      diselesaikanPada: updated.diselesaikanPada
        ? updated.diselesaikanPada.toISOString()
        : null,
      status: updated.status,
    });
  } catch (err) {
    console.error("POST /api/agenda/[id]/selesai error:", err);
    if (err instanceof Error && err.message.includes("Telegram")) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal menandai agenda selesai. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
