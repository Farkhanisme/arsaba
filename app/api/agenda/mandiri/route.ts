import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["KARYAWAN", "KEPALA_TOKO"];

// POST /api/agenda/mandiri
// Karyawan lapor kegiatan mandiri (di luar template pusat) + bukti foto.
// Body: multipart/form-data — judul (str), deskripsi (str opsional), foto (File wajib).
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melaporkan agenda mandiri." },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const judul = formData.get("judul");
    const deskripsiRaw = formData.get("deskripsi");
    const foto = formData.get("foto") as File | null;

    if (typeof judul !== "string" || judul.trim().length < 3) {
      return NextResponse.json(
        { error: "Field 'judul' wajib diisi, minimal 3 karakter." },
        { status: 400 }
      );
    }

    let deskripsi: string | null = null;
    if (typeof deskripsiRaw === "string" && deskripsiRaw.trim().length > 0) {
      deskripsi = deskripsiRaw.trim();
    }

    if (!foto) {
      return NextResponse.json(
        { error: "Field 'foto' wajib diisi sebagai bukti." },
        { status: 400 }
      );
    }

    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `agenda-mandiri-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, {
      asDocument: false,
    });

    const now = new Date();

    const created = await prisma.agenda.create({
      data: {
        judul: judul.trim(),
        deskripsi,
        nominal: 0,
        sumber: "MANDIRI_KARYAWAN",
        targetEmployeeId: session.user.id,
        targetStoreId: null,
        buktiFileId: uploadResult.fileId,
        diselesaikanPada: now,
        createdById: session.user.id,
      },
    });

    return NextResponse.json({
      id: created.id,
      judul: created.judul,
      deskripsi: created.deskripsi,
      sumber: created.sumber,
      status: created.status,
      buktiFileId: created.buktiFileId,
      diselesaikanPada: created.diselesaikanPada
        ? created.diselesaikanPada.toISOString()
        : null,
      nominal: created.nominal,
    });
  } catch (err) {
    console.error("POST /api/agenda/mandiri error:", err);
    if (err instanceof Error && err.message.includes("Telegram")) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal melaporkan agenda mandiri. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
