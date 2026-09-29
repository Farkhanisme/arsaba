import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const MIN_ALASAN = 10;

type Body = {
  alasan?: unknown;
};

/**
 * POST /api/payroll/[id]/revise
 * Body: { alasan: string }
 *
 * Mekanisme revisi payroll (spesifikasi §7.1b) — **unlock dengan audit**.
 *
 * Kenapa perlu: `PATCH /api/payroll/[id]` menolak edit saat LOCKED (itu benar),
 * tapi SEBELUM ada endpoint ini, payroll yang sudah LOCKED tidak punya jalan
 * koreksi sama sekali. Karena sumber angkanya (nominal bonus agenda, koreksi jam)
 * bisa saja berubah setelah lock, Manajer harus punya cara resmi —
 * dan jejaknya harus terlihat.
 *
 * Yang dilakukan:
 *   1. Validasi alasan (wajib, min 10 karakter) — supaya jejaknya berguna.
 *   2. Status kembali LOCKED -> DRAFT, `lockedAt`/`lockedById` dikosongkan.
 *   3. `revisiKe` naik 1, `revisiAlasan` disimpan.
 *   4. `AuditLog` dengan `aksi: "REVISI"` + nilai sebelum & sesudah.
 *
 * TIDAK ada jalur edit langsung ke payroll LOCKED — hanya lewat endpoint ini.
 */
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
        { error: "Hanya MANAJER yang boleh merevisi payroll." },
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

    const alasan = typeof body.alasan === "string" ? body.alasan.trim() : "";
    if (alasan.length < MIN_ALASAN) {
      return NextResponse.json(
        {
          error: `Field 'alasan' wajib diisi, minimal ${MIN_ALASAN} karakter. Ini tersimpan di jejak audit.`,
        },
        { status: 400 }
      );
    }

    const existing = await prisma.payroll.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Payroll tidak ditemukan." },
        { status: 404 }
      );
    }
    if (existing.status !== "LOCKED") {
      return NextResponse.json(
        {
          error: `Payroll tidak dalam status LOCKED (saat ini: ${existing.status}), tidak perlu direvisi.`,
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.payroll.update({
        where: { id },
        data: {
          status: "DRAFT",
          lockedAt: null,
          lockedById: null,
          revisiKe: existing.revisiKe + 1,
          revisiAlasan: alasan,
        },
      });

      await tx.auditLog.create({
        data: {
          tabel: "Payroll",
          recordId: id,
          aksi: "REVISI",
          nilaiSebelum: {
            status: "LOCKED",
            lockedAt: existing.lockedAt?.toISOString() ?? null,
            lockedById: existing.lockedById,
            totalGaji: existing.totalGaji,
            revisiKe: existing.revisiKe,
          },
          nilaiSesudah: {
            status: "DRAFT",
            revisiKe: updated.revisiKe,
            revisiAlasan: updated.revisiAlasan,
          },
          actorId: session.user.id,
          alasan,
        },
      });

      return updated;
    });

    return NextResponse.json({
      id: result.id,
      status: result.status,
      revisiKe: result.revisiKe,
      revisiAlasan: result.revisiAlasan,
      pesan:
        "Payroll dibuka untuk revisi. Edit field yang perlu, lalu kunci lagi setelah selesai.",
    });
  } catch (err) {
    console.error("POST /api/payroll/[id]/revise error:", err);
    return NextResponse.json(
      { error: "Gagal merevisi payroll." },
      { status: 500 }
    );
  }
}
