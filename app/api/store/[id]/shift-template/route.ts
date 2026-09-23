import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

// POST /api/store/[id]/shift-template
export async function POST(
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
        { error: "Role Anda tidak berwenang membuat template shift." },
        { status: 403 }
      );
    }

    const { id: storeId } = await params;

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
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

    const jamMulaiMenit = body.jamMulaiMenit;
    const jamSelesaiMenit = body.jamSelesaiMenit;
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

    const lintasHari = body.lintasHari === true;
    const aktif = body.aktif === true;

    // Validasi jam jika lintasHari
    if (!lintasHari && jamMulaiMenit >= jamSelesaiMenit) {
      return NextResponse.json(
        { error: "Jam selesai harus setelah jam mulai (kecuali shift lintas hari)." },
        { status: 400 }
      );
    }

    // hariKerja: array int (0-6), default []
    let hariKerja: number[] = [];
    if (Array.isArray(body.hariKerja)) {
      hariKerja = body.hariKerja
        .filter((h): h is number => Number.isInteger(h) && h >= 0 && h <= 6)
        .filter((h, i, arr) => arr.indexOf(h) === i); // unique
    }

    // Cek duplikat nama per toko
    const existing = await prisma.shiftTemplate.findUnique({
      where: { storeId_nama: { storeId, nama: nama.trim() } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Template dengan nama ini sudah ada di toko ini." },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.shiftTemplate.create({
        data: {
          storeId,
          nama: nama.trim(),
          jamMulaiMenit,
          jamSelesaiMenit,
          lintasHari,
          hariKerja,
          aktif,
        },
      });

      await tx.auditLog.create({
        data: {
          tabel: "ShiftTemplate",
          recordId: template.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: template.id,
            storeId,
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

    return NextResponse.json(
      {
        id: created.id,
        storeId: created.storeId,
        nama: created.nama,
        jamMulaiMenit: created.jamMulaiMenit,
        jamSelesaiMenit: created.jamSelesaiMenit,
        lintasHari: created.lintasHari,
        hariKerja: created.hariKerja,
        aktif: created.aktif,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/store/[id]/shift-template error:", err);
    return NextResponse.json({ error: "Gagal membuat template shift." }, { status: 500 });
  }
}
