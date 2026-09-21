import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const RESETTABLE_TARGET_ROLES: Role[] = [
  "KARYAWAN",
  "KEPALA_TOKO",
  "SUPERVISOR",
  "ADMIN",
];

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

    if (!RESETTABLE_TARGET_ROLES.includes(target.role)) {
      return NextResponse.json(
        {
          error:
            "Target tidak bisa direset. Hanya supervisor ke bawah yang bisa direset dari halaman ini.",
        },
        { status: 403 }
      );
    }

    const hashedPassword = await bcrypt.hash(passwordBaru, 10);

    await prisma.user.update({
      where: { id },
      data: { hashedPassword },
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
