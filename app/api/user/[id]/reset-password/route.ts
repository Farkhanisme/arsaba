import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bolehSetRole } from "@/lib/rbac";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

type Body = {
  passwordBaru?: unknown;
};

// PATCH /api/user/[id]/reset-password
// Body: { passwordBaru: string (min 6) }
// Hanya SUPERVISOR/ADMIN/MANAJER. Target harus supervisor ke bawah.
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
        { error: "Role Anda tidak berwenang mereset password." },
        { status: 403 }
      );
    }

    const { id } = await params;

    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Tidak bisa reset password Anda sendiri dari halaman ini." },
        { status: 400 }
      );
    }

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const passwordBaru = body.passwordBaru;
    if (typeof passwordBaru !== "string" || passwordBaru.length < 6) {
      return NextResponse.json(
        { error: "Field 'passwordBaru' wajib diisi, minimal 6 karakter." },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, nama: true, role: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "User tidak ditemukan." },
        { status: 404 }
      );
    }

    // Hierarki: hanya boleh mereset akun di bawah level actor. Konsisten dengan
    // PATCH /api/user/[id] yang memakai bolehSetRole(). Dulu route ini memakai
    // allowlist terpisah (RESETTABLE_TARGET_ROLES), sehingga dua route bisa
    // berbeda untuk kasus yang sama.
    if (!bolehSetRole(session.user.role, target.role)) {
      return NextResponse.json(
        {
          error:
            "Tidak berwenang mereset password akun dengan role di atas atau sama dengan level Anda.",
        },
        { status: 403 }
      );
    }

    const hashedPassword = await bcrypt.hash(passwordBaru, 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { hashedPassword },
      });

      // Audit log wajib untuk perubahan master data (§8:415). Hash password
      // TIDAK PERNAH ditulis ke mana pun — cukup catat bahwa reset terjadi.
      await tx.auditLog.create({
        data: {
          tabel: "User",
          recordId: id,
          aksi: "UPDATE",
          nilaiSebelum: { id, passwordDireset: false },
          nilaiSesudah: { id, passwordDireset: true },
          actorId: session.user.id,
        },
      });
    });

    return NextResponse.json({
      id: target.id,
      nama: target.nama,
      message: "Password berhasil direset.",
    });
  } catch (err) {
    console.error("PATCH /api/user/[id]/reset-password error:", err);
    return NextResponse.json(
      { error: "Gagal mereset password." },
      { status: 500 }
    );
  }
}
