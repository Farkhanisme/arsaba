import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

function validasiJam(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439;
}

// GET /api/shift-template/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const template = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json({ error: "Template tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (err) {
    console.error("GET /api/shift-template/[id] error:", err);
    return NextResponse.json({ error: "Gagal memuat template." }, { status: 500 });
  }
}

// PATCH /api/shift-template/[id]
// Body: partial { nama?, jamMulaiMenit?, jamSelesaiMenit?, lintasHari?, aktif? }
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
        { error: "Role Anda tidak berwenang mengelola shift template." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const existing = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template tidak ditemukan." }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const data: {
      nama?: string;
      jamMulaiMenit?: number;
      jamSelesaiMenit?: number;
      lintasHari?: boolean;
      aktif?: boolean;
    } = {};

    if ("nama" in body) {
      const nama = body.nama;
      if (typeof nama !== "string" || nama.trim().length < 2 || nama.trim().length > 30) {
        return NextResponse.json(
          { error: "Field 'nama' harus 2-30 karakter." },
          { status: 400 }
        );
      }
      data.nama = nama.trim();
    }

    if ("jamMulaiMenit" in body) {
      if (!validasiJam(body.jamMulaiMenit)) {
        return NextResponse.json(
          { error: "Field 'jamMulaiMenit' harus integer 0-1439." },
          { status: 400 }
        );
      }
      data.jamMulaiMenit = body.jamMulaiMenit;
    }

    if ("jamSelesaiMenit" in body) {
      if (!validasiJam(body.jamSelesaiMenit)) {
        return NextResponse.json(
          { error: "Field 'jamSelesaiMenit' harus integer 0-1439." },
          { status: 400 }
        );
      }
      data.jamSelesaiMenit = body.jamSelesaiMenit;
    }

    if ("lintasHari" in body) {
      if (typeof body.lintasHari !== "boolean") {
        return NextResponse.json(
          { error: "Field 'lintasHari' harus boolean." },
          { status: 400 }
        );
      }
      data.lintasHari = body.lintasHari;
    }

    if ("aktif" in body) {
      if (typeof body.aktif !== "boolean") {
        return NextResponse.json(
          { error: "Field 'aktif' harus boolean." },
          { status: 400 }
        );
      }
      data.aktif = body.aktif;
    }

    const nextJamMulai = data.jamMulaiMenit ?? existing.jamMulaiMenit;
    const nextJamSelesai = data.jamSelesaiMenit ?? existing.jamSelesaiMenit;
    const nextLintasHari = data.lintasHari ?? existing.lintasHari;

    if (!nextLintasHari && nextJamSelesai <= nextJamMulai) {
      return NextResponse.json(
        {
          error:
            "Jika lintasHari=false, jamSelesaiMenit harus lebih besar dari jamMulaiMenit.",
        },
        { status: 400 }
      );
    }
    if (nextLintasHari && nextJamSelesai > nextJamMulai) {
      return NextResponse.json(
        {
          error:
            "Jika lintasHari=true, jamSelesaiMenit harus <= jamMulaiMenit.",
        },
        { status: 400 }
      );
    }

    try {
      const updated = await prisma.shiftTemplate.update({
        where: { id },
        data,
      });
      return NextResponse.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json(
          { error: `Nama template tersebut sudah dipakai di toko ini.` },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("PATCH /api/shift-template/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal memperbarui template." },
      { status: 500 }
    );
  }
}

// DELETE /api/shift-template/[id]
// Soft delete: set aktif=false
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const existing = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template tidak ditemukan." }, { status: 404 });
    }

    const updated = await prisma.shiftTemplate.update({
      where: { id },
      data: { aktif: false },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("DELETE /api/shift-template/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus template." },
      { status: 500 }
    );
  }
}
