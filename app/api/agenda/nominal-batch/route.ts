import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { payrollLocked } from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma, Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const NOMINAL_MAX = 10_000_000;

type Body = {
  nominal?: unknown;
  sumber?: unknown;
  templateId?: unknown;
  /** true = hanya hitung & kembalikan berapa record yang akan berubah. */
  preview?: unknown;
  alasan?: unknown;
};

// POST /api/agenda/nominal-batch
// Body: { nominal, sumber? | templateId?, preview?: boolean, alasan?: string }
// Hanya MANAJER. Set nominal untuk agenda DIVERIFIKASI yang nominal-nya null.
//
// PERILAKU AMAN YANG WAJIB DIPAKAI DI UI:
//   1. Panggil dengan `preview: true` dulu — route hanya mengembalikan
//      { total, sample, ditolakLocked } tanpa mengubah apa pun. Tampilkan
//      jumlah itu ke user sebagai konfirmasi.
//   2. Kalau user setuju, panggil lagi tanpa `preview`.
//
// Kenapa wajib: `updateMany` bisa menyangkut ratusan baris lintas toko. Tanpa
// preview, Manajer mengetik angka lalu menekan tombol sekali dan seluruhnya
// berubah — dan TIDAK ada jejak karena `updateMany` tidak bisa menulis audit
// per-row. Dua masalah itu yang diperbaiki di sini.
//
// Agenda dengan payroll bulanannya sudah LOCKED DILEWATI (tidak ikut diubah) —
// payslip-nya sudah final, jadi nominal tidak boleh bergerak lagi.

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya Manajer yang berwenang menetapkan nominal." },
        { status: 403 }
      );
    }

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const nominal = body.nominal;
    if (
      typeof nominal !== "number" ||
      !Number.isInteger(nominal) ||
      nominal < 0 ||
      nominal > NOMINAL_MAX
    ) {
      return NextResponse.json(
        { error: `Field 'nominal' wajib integer 0-${NOMINAL_MAX}.` },
        { status: 400 }
      );
    }

    const isPreview = body.preview === true;
    const alasan =
      typeof body.alasan === "string" && body.alasan.trim().length > 0
        ? body.alasan.trim()
        : null;

    const sumberFilter = body.sumber;
    const templateIdFilter = body.templateId;

    if (sumberFilter === undefined && templateIdFilter === undefined) {
      return NextResponse.json(
        {
          error:
            "Minimal salah satu filter wajib diisi: 'sumber' atau 'templateId'.",
        },
        { status: 400 }
      );
    }

    if (
      sumberFilter !== undefined &&
      sumberFilter !== "TEMPLATE_PUSAT" &&
      sumberFilter !== "MANDIRI_KARYAWAN"
    ) {
      return NextResponse.json(
        {
          error:
            "Field 'sumber' harus 'TEMPLATE_PUSAT' atau 'MANDIRI_KARYAWAN'.",
        },
        { status: 400 }
      );
    }

    if (
      templateIdFilter !== undefined &&
      (typeof templateIdFilter !== "string" || templateIdFilter.length === 0)
    ) {
      return NextResponse.json(
        { error: "Field 'templateId' harus string non-empty." },
        { status: 400 }
      );
    }

    const where: Prisma.AgendaWhereInput = {
      status: "DIVERIFIKASI",
      nominal: null,
      // Template master tidak punya target — tidak masuk hitungan gaji.
      targetEmployeeId: { not: null },
    };
    if (sumberFilter !== undefined) {
      where.sumber = sumberFilter;
    }
    if (templateIdFilter !== undefined) {
      where.templateId = templateIdFilter;
    }

    // Ambil record yang cocok beserta konteks payroll-nya. Dipakai untuk
    // preview, untuk menyaring yang LOCKED, dan untuk menulis audit.
    const kandidat = await prisma.agenda.findMany({
      where,
      select: {
        id: true,
        judul: true,
        targetEmployeeId: true,
        diselesaikanPada: true,
      },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });

    // Pisahkan yang boleh diubah vs yang payroll-nya sudah final.
    const boleh: typeof kandidat = [];
    const terkunciIds: string[] = [];
    for (const k of kandidat) {
      if (k.targetEmployeeId && k.diselesaikanPada) {
        if (await payrollLocked(prisma, k.targetEmployeeId, k.diselesaikanPada)) {
          terkunciIds.push(k.id);
          continue;
        }
      }
      boleh.push(k);
    }

    const ringkas = boleh.slice(0, 5).map((k) => ({
      id: k.id,
      judul: k.judul,
    }));

    if (isPreview) {
      return NextResponse.json({
        preview: true,
        total: boleh.length,
        ditolakLocked: terkunciIds.length,
        sample: ringkas,
        pesan:
          boleh.length > 0
            ? `${boleh.length} agenda akan diubah.${terkunciIds.length > 0 ? ` ${terkunciIds.length} agenda dilewati karena payroll-nya sudah dikunci.` : ""}`
            : "Tidak ada agenda yang cocok.",
      });
    }

    if (boleh.length === 0) {
      return NextResponse.json({
        updated: 0,
        ditolakLocked: terkunciIds.length,
        pesan:
          terkunciIds.length > 0
            ? "Semua agenda yang cocok sudah memiliki nominal atau payroll-nya sudah dikunci."
            : "Tidak ada agenda yang cocok.",
      });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.agenda.updateMany({
        where: { id: { in: boleh.map((k) => k.id) } },
        data: {
          nominal,
          nominalSetById: session.user.id,
          nominalSetAt: now,
        },
      });

      // updateMany tidak menulis audit — lakukan manual per record.
      // Ini yang hilang di implementasi lama.
      await tx.auditLog.createMany({
        data: boleh.map((k) => ({
          tabel: "Agenda",
          recordId: k.id,
          aksi: "UPDATE",
          nilaiSebelum: { nominal: null },
          nilaiSesudah: { nominal },
          actorId: session.user.id,
          alasan: `Set nominal batch${alasan ? `: ${alasan}` : ""}`,
        })),
      });
    });

    return NextResponse.json({
      updated: boleh.length,
      ditolakLocked: terkunciIds.length,
    });
  } catch (err) {
    console.error("POST /api/agenda/nominal-batch error:", err);
    return NextResponse.json(
      { error: "Gagal menetapkan nominal batch. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
