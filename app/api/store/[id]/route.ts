import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

type Body = {
  nama?: unknown;
  alias?: unknown;
  aktif?: unknown;
  pamEnabled?: unknown;
};

// PATCH /api/store/[id] — update toko. Hanya ADMIN.
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
        { error: "Role Anda tidak berwenang mengubah toko." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Toko tidak ditemukan." },
        { status: 404 }
      );
    }

    const data: Record<string, unknown> = {};

    if (body.nama !== undefined) {
      if (typeof body.nama !== "string" || body.nama.trim().length < 2) {
        return NextResponse.json(
          { error: "Field 'nama' harus diisi, minimal 2 karakter." },
          { status: 400 }
        );
      }
      data.nama = body.nama.trim();
    }

    if (body.alias !== undefined) {
      if (body.alias === null || body.alias === "") {
        data.alias = null;
      } else if (typeof body.alias === "string") {
        data.alias = body.alias.trim();
      } else {
        return NextResponse.json(
          { error: "Field 'alias' harus string atau null." },
          { status: 400 }
        );
      }
    }

    if (body.aktif !== undefined) {
      if (typeof body.aktif !== "boolean") {
        return NextResponse.json(
          { error: "Field 'aktif' harus boolean." },
          { status: 400 }
        );
      }
      data.aktif = body.aktif;
    }

    if (body.pamEnabled !== undefined) {
      if (typeof body.pamEnabled !== "boolean") {
        return NextResponse.json(
          { error: "Field 'pamEnabled' harus boolean." },
          { status: 400 }
        );
      }
      data.pamEnabled = body.pamEnabled;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Tidak ada field yang diubah." },
        { status: 400 }
      );
    }

    const updated = await prisma.store.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      id: updated.id,
      nama: updated.nama,
      alias: updated.alias,
      aktif: updated.aktif,
      pamEnabled: updated.pamEnabled,
    });
  } catch (err) {
    console.error("PATCH /api/store/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal mengubah toko." },
      { status: 500 }
    );
  }
}
