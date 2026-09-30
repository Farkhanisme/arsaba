import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

// PATCH /api/auth/change-password
// Body: { passwordLama: string, passwordBaru: string (min 6) }
// User mengubah password sendiri (tidak perlu userId param — ambil dari session)
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const passwordLama = body.passwordLama;
    const passwordBaru = body.passwordBaru;

    if (typeof passwordLama !== "string" || passwordLama.length === 0) {
      return NextResponse.json({ error: "Field 'passwordLama' wajib diisi." }, { status: 400 });
    }
    if (typeof passwordBaru !== "string" || passwordBaru.length < 6) {
      return NextResponse.json({ error: "Field 'passwordBaru' wajib diisi, minimal 6 karakter." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, kode: true, nama: true, hashedPassword: true },
    });
    if (!user || !user.hashedPassword) {
      return NextResponse.json({ error: "Akun tidak valid atau belum punya password." }, { status: 400 });
    }

    // Cek password lama
    const cocok = await bcrypt.compare(passwordLama, user.hashedPassword);
    if (!cocok) {
      return NextResponse.json({ error: "Password lama tidak cocok." }, { status: 403 });
    }

    // Cek tidak sama dengan password lama
    if (passwordLama === passwordBaru) {
      return NextResponse.json({ error: "Password baru tidak boleh sama dengan password lama." }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(passwordBaru, 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { hashedPassword },
      });

      await tx.auditLog.create({
        data: {
          tabel: "User",
          recordId: user.id,
          aksi: "UPDATE",
          nilaiSebelum: { id: user.id, passwordDiubah: false },
          nilaiSesudah: { id: user.id, passwordDiubah: true },
          actorId: user.id,
          alasan: "Ubah password oleh pengguna sendiri",
        },
      });
    });

    return NextResponse.json({
      id: user.id,
      kode: user.kode,
      nama: user.nama,
      message: "Password berhasil diubah.",
    });
  } catch (err) {
    console.error("PATCH /api/auth/change-password error:", err);
    return NextResponse.json({ error: "Gagal mengubah password." }, { status: 500 });
  }
}
