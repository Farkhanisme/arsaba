import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

// POST /api/agenda/[id]/selesai
// Karyawan tandai agenda selesai: upload bukti foto + set diselesaikanPada.
// Body: multipart/form-data, field 'foto' (File, wajib).
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
    const foto = formData.get("foto") as File | null;

    if (!foto) {
      return NextResponse.json(
        { error: "Field 'foto' wajib diisi." },
        { status: 400 }
      );
    }

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

    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename =
      foto.name || `agenda-selesai-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, {
      asDocument: false,
    });

    const now = new Date();
    const updated = await prisma.agenda.update({
      where: { id },
      data: {
        buktiFileId: uploadResult.fileId,
        diselesaikanPada: now,
      },
    });

    return NextResponse.json({
      id: updated.id,
      buktiFileId: updated.buktiFileId,
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
