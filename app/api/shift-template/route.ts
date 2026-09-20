import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

function validasiJamMulai(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439;
}

function validasiJamSelesai(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439;
}

// GET /api/shift-template?storeId=X&includeInactive=true
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengelola shift template." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    if (!storeId) {
      return NextResponse.json({ error: "Query 'storeId' wajib diisi" }, { status: 400 });
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    const templates = await prisma.shiftTemplate.findMany({
      where: {
        storeId,
        ...(includeInactive ? {} : { aktif: true }),
      },
      orderBy: { jamMulaiMenit: "asc" },
    });

    return NextResponse.json({ templates });
  } catch (err) {
    console.error("GET /api/shift-template error:", err);
    return NextResponse.json(
      { error: "Gagal memuat daftar template." },
      { status: 500 }
    );
  }
}

// POST /api/shift-template
// Body: { storeId, nama, jamMulaiMenit, jamSelesaiMenit, lintasHari }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengelola shift template." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const storeId = body.storeId;
    const nama = body.nama;
    const jamMulaiMenit = body.jamMulaiMenit;
    const jamSelesaiMenit = body.jamSelesaiMenit;
    const lintasHari = body.lintasHari;

    if (typeof storeId !== "string" || storeId.length === 0) {
      return NextResponse.json({ error: "Field 'storeId' wajib diisi" }, { status: 400 });
    }
    if (typeof nama !== "string" || nama.trim().length < 2 || nama.trim().length > 30) {
      return NextResponse.json(
        { error: "Field 'nama' wajib diisi, 2-30 karakter." },
        { status: 400 }
      );
    }
    if (!validasiJamMulai(jamMulaiMenit)) {
      return NextResponse.json(
        { error: "Field 'jamMulaiMenit' harus integer 0-1439." },
        { status: 400 }
      );
    }
    if (!validasiJamSelesai(jamSelesaiMenit)) {
      return NextResponse.json(
        { error: "Field 'jamSelesaiMenit' harus integer 0-1439." },
        { status: 400 }
      );
    }
    if (typeof lintasHari !== "boolean") {
      return NextResponse.json(
        { error: "Field 'lintasHari' harus boolean." },
        { status: 400 }
      );
    }

    if (!lintasHari && jamSelesaiMenit <= jamMulaiMenit) {
      return NextResponse.json(
        {
          error:
            "Jika lintasHari=false, jamSelesaiMenit harus lebih besar dari jamMulaiMenit.",
        },
        { status: 400 }
      );
    }
    if (lintasHari && jamSelesaiMenit > jamMulaiMenit) {
      return NextResponse.json(
        {
          error:
            "Jika lintasHari=true, jamSelesaiMenit harus <= jamMulaiMenit.",
        },
        { status: 400 }
      );
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    try {
      const created = await prisma.shiftTemplate.create({
        data: {
          storeId,
          nama: nama.trim(),
          jamMulaiMenit,
          jamSelesaiMenit,
          lintasHari,
        },
      });
      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json(
          { error: `Template dengan nama "${nama.trim()}" sudah ada di toko ini.` },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("POST /api/shift-template error:", err);
    return NextResponse.json(
      { error: "Gagal membuat template." },
      { status: 500 }
    );
  }
}
