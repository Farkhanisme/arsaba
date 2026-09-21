import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_READ_ROLES: Role[] = ["ADMIN", "MANAJER", "SUPERVISOR"];
const ALLOWED_WRITE_ROLES: Role[] = ["ADMIN"];

// GET /api/store — list semua toko.
// Query opsional: ?aktif=true
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_READ_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar toko." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const aktifParam = searchParams.get("aktif");

    const where: Record<string, unknown> = {};
    if (aktifParam === "true") {
      where.aktif = true;
    } else if (aktifParam === "false") {
      where.aktif = false;
    }

    const items = await prisma.store.findMany({
      where,
      orderBy: { nama: "asc" },
      select: {
        id: true,
        nama: true,
        alias: true,
        aktif: true,
        pamEnabled: true,
      },
    });

    return NextResponse.json({
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("GET /api/store error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar toko." },
      { status: 500 }
    );
  }
}

// POST /api/store — bikin toko baru. Hanya ADMIN.
// Body: { nama, alias?, pamEnabled? }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya Admin yang berwenang membuat toko." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const nama = body.nama;
    if (typeof nama !== "string" || nama.trim().length < 2) {
      return NextResponse.json(
        { error: "Field 'nama' wajib diisi, minimal 2 karakter." },
        { status: 400 }
      );
    }

    const alias =
      typeof body.alias === "string" && body.alias.trim().length > 0
        ? body.alias.trim()
        : null;

    let pamEnabled = true;
    if (body.pamEnabled !== undefined) {
      if (typeof body.pamEnabled !== "boolean") {
        return NextResponse.json(
          { error: "Field 'pamEnabled' harus boolean bila diisi." },
          { status: 400 }
        );
      }
      pamEnabled = body.pamEnabled;
    }

    const created = await prisma.store.create({
      data: {
        nama: nama.trim(),
        alias,
        pamEnabled,
      },
    });

    return NextResponse.json({
      id: created.id,
      nama: created.nama,
      alias: created.alias,
      aktif: created.aktif,
      pamEnabled: created.pamEnabled,
    });
  } catch (err) {
    console.error("POST /api/store error:", err);
    return NextResponse.json(
      { error: "Gagal membuat toko." },
      { status: 500 }
    );
  }
}
