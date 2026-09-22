import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["KARYAWAN", "KEPALA_TOKO"];

// POST /api/agenda/mandiri
// Karyawan lapor kegiatan mandiri (di luar template pusat) + bukti foto.
// Body: multipart/form-data — judul (str), deskripsi (str opsional), fotoBefore (File opsional), fotoAfter (File opsional).
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
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
    const fotoBefore = formData.get("fotoBefore") as File | null;
    const fotoAfter = formData.get("fotoAfter") as File | null;

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

    let buktiBeforeFileId: string | null = null;
    let buktiAfterFileId: string | null = null;

    if (fotoBefore) {
      const beforeBuf = Buffer.from(await fotoBefore.arrayBuffer());
      const beforeName =
        fotoBefore.name || `agenda-mandiri-sebelum-${Date.now()}.jpg`;
      const beforeResult = await uploadToTelegram(beforeBuf, beforeName, {
        asDocument: false,
      });
      buktiBeforeFileId = beforeResult.fileId;
    }

    if (fotoAfter) {
      const afterBuf = Buffer.from(await fotoAfter.arrayBuffer());
      const afterName =
        fotoAfter.name || `agenda-mandiri-sesudah-${Date.now()}.jpg`;
      const afterResult = await uploadToTelegram(afterBuf, afterName, {
        asDocument: false,
      });
      buktiAfterFileId = afterResult.fileId;
    }

    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const created = await tx.agenda.create({
        data: {
          judul: judul.trim(),
          deskripsi,
          nominal: null,
          sumber: "MANDIRI_KARYAWAN",
          targetEmployeeId: session.user.id,
          targetStoreId: null,
          buktiBeforeFileId,
          buktiAfterFileId,
          diselesaikanPada: now,
          createdById: session.user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tabel: "Agenda",
          recordId: created.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: created.id,
            judul: created.judul,
            deskripsi: created.deskripsi,
            nominal: created.nominal,
            sumber: created.sumber,
            targetStoreId: created.targetStoreId,
            targetEmployeeId: created.targetEmployeeId,
            deadline: created.deadline?.toISOString() ?? null,
            status: created.status,
            templateId: created.templateId,
            buktiBeforeFileId: created.buktiBeforeFileId,
            buktiAfterFileId: created.buktiAfterFileId,
            diselesaikanPada: created.diselesaikanPada?.toISOString() ?? null,
            createdById: created.createdById,
          },
          actorId: session.user.id,
        },
      });

      return created;
    });

    return NextResponse.json({
      id: created.id,
      judul: created.judul,
      deskripsi: created.deskripsi,
      sumber: created.sumber,
      status: created.status,
      buktiBeforeFileId: created.buktiBeforeFileId,
      buktiAfterFileId: created.buktiAfterFileId,
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
