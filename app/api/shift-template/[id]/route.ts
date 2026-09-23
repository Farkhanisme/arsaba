import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

// GET /api/shift-template/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat template shift." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const template = await prisma.shiftTemplate.findUnique({
      where: { id },
      include: { store: { select: { id: true, nama: true } } },
    });

    if (!template) {
      return NextResponse.json({ error: "Template shift tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({
      id: template.id,
      storeId: template.storeId,
      store: template.store,
      nama: template.nama,
      jamMulaiMenit: template.jamMulaiMenit,
      jamSelesaiMenit: template.jamSelesaiMenit,
      lintasHari: template.lintasHari,
      hariKerja: template.hariKerja,
      aktif: template.aktif,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("GET /api/shift-template/[id] error:", err);
    return NextResponse.json({ error: "Gagal mengambil template shift." }, { status: 500 });
  }
}

// PATCH /api/shift-template/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengubah template shift." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const existing = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template shift tidak ditemukan." }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};

    if (body.nama !== undefined) {
      const nama = body.nama;
      if (typeof nama !== "string" || nama.trim().length < 2) {
        return NextResponse.json(
          { error: "Field 'nama' wajib diisi, minimal 2 karakter." },
          { status: 400 }
        );
      }
      // Cek duplikat nama per toko (exclude self)
      const dup = await prisma.shiftTemplate.findFirst({
        where: {
          storeId: existing.storeId,
          nama: nama.trim(),
          NOT: { id },
        },
      });
      if (dup) {
        return NextResponse.json(
          { error: "Template dengan nama ini sudah ada di toko ini." },
          { status: 409 }
        );
      }
      updateData.nama = nama.trim();
    }

    if (body.jamMulaiMenit !== undefined) {
      const jamMulaiMenit = body.jamMulaiMenit;
      if (
        typeof jamMulaiMenit !== "number" ||
        jamMulaiMenit < 0 ||
        jamMulaiMenit > 1439
      ) {
        return NextResponse.json(
          { error: "Field 'jamMulaiMenit' harus integer 0-1439." },
          { status: 400 }
        );
      }
      updateData.jamMulaiMenit = jamMulaiMenit;
    }

    if (body.jamSelesaiMenit !== undefined) {
      const jamSelesaiMenit = body.jamSelesaiMenit;
      if (
        typeof jamSelesaiMenit !== "number" ||
        jamSelesaiMenit < 0 ||
        jamSelesaiMenit > 1439
      ) {
        return NextResponse.json(
          { error: "Field 'jamSelesaiMenit' harus integer 0-1439." },
          { status: 400 }
        );
      }
      updateData.jamSelesaiMenit = jamSelesaiMenit;
    }

    if (body.lintasHari !== undefined) {
      updateData.lintasHari = body.lintasHari === true;
    }

    if (body.aktif !== undefined) {
      updateData.aktif = body.aktif === true;
    }

    if (Array.isArray(body.hariKerja)) {
      const hariKerja = body.hariKerja
        .filter((h): h is number => Number.isInteger(h) && h >= 0 && h <= 6)
        .filter((h, i, arr) => arr.indexOf(h) === i);
      updateData.hariKerja = hariKerja;
    }

    // Validasi jam jika lintasHari
    const jamMulai = updateData.jamMulaiMenit ?? existing.jamMulaiMenit;
    const jamSelesai = updateData.jamSelesaiMenit ?? existing.jamSelesaiMenit;
    const lintasHari = updateData.lintasHari ?? existing.lintasHari;
    if (!lintasHari && jamMulai >= jamSelesai) {
      return NextResponse.json(
        { error: "Jam selesai harus setelah jam mulai (kecuali shift lintas hari)." },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const template = await tx.shiftTemplate.update({
        where: { id },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          tabel: "ShiftTemplate",
          recordId: template.id,
          aksi: "UPDATE",
          nilaiSebelum: {
            id: existing.id,
            nama: existing.nama,
            jamMulaiMenit: existing.jamMulaiMenit,
            jamSelesaiMenit: existing.jamSelesaiMenit,
            lintasHari: existing.lintasHari,
            hariKerja: existing.hariKerja,
            aktif: existing.aktif,
          },
          nilaiSesudah: {
            id: template.id,
            nama: template.nama,
            jamMulaiMenit: template.jamMulaiMenit,
            jamSelesaiMenit: template.jamSelesaiMenit,
            lintasHari: template.lintasHari,
            hariKerja: template.hariKerja,
            aktif: template.aktif,
          },
          actorId: session.user.id,
        },
      });

      return template;
    });

    return NextResponse.json({
      id: updated.id,
      storeId: updated.storeId,
      nama: updated.nama,
      jamMulaiMenit: updated.jamMulaiMenit,
      jamSelesaiMenit: updated.jamSelesaiMenit,
      lintasHari: updated.lintasHari,
      hariKerja: updated.hariKerja,
      aktif: updated.aktif,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/shift-template/[id] error:", err);
    return NextResponse.json({ error: "Gagal mengubah template shift." }, { status: 500 });
  }
}

// DELETE /api/shift-template/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang menghapus template shift." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const existing = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template shift tidak ditemukan." }, { status: 404 });
    }

    // Cek apakah dipakai di ShiftInstance
    const usage = await prisma.shiftInstance.count({
      where: { templateId: id },
    });
    if (usage > 0) {
      return NextResponse.json(
        { error: `Template ini sudah dipakai di ${usage} jadwal shift. Hapus jadwal tersebut terlebih dahulu.` },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.shiftTemplate.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          tabel: "ShiftTemplate",
          recordId: id,
          aksi: "DELETE",
          nilaiSebelum: {
            id: existing.id,
            storeId: existing.storeId,
            nama: existing.nama,
            jamMulaiMenit: existing.jamMulaiMenit,
            jamSelesaiMenit: existing.jamSelesaiMenit,
            lintasHari: existing.lintasHari,
            hariKerja: existing.hariKerja,
            aktif: existing.aktif,
          },
          actorId: session.user.id,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/shift-template/[id] error:", err);
    return NextResponse.json({ error: "Gagal menghapus template shift." }, { status: 500 });
  }
}