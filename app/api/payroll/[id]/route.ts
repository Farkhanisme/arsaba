import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_READ_ROLES: Role[] = [
  "DIREKTUR",
  "MANAJER",
  "SUPERVISOR",
  "ADMIN",
  "KEPALA_TOKO",
  "KARYAWAN",
];
const ALLOWED_WRITE_ROLES: Role[] = ["MANAJER"];

const MAX_AMOUNT = 100_000_000;

interface PatchBody {
  bonusManual?: unknown;
  potonganManual?: unknown;
  bonusPerforma?: unknown;
  keteranganBonusPerforma?: unknown;
}

function validateNonNegativeInt(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Field '${fieldName}' harus integer >= 0.`);
  }
  if (value > MAX_AMOUNT) {
    throw new Error(`Field '${fieldName}' maksimal ${MAX_AMOUNT.toLocaleString("id-ID")}.`);
  }
  return value;
}

function validateOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Field '${fieldName}' harus string.`);
  }
  return value;
}

// GET /api/payroll/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }

    if (!ALLOWED_READ_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat detail payroll." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const payroll = await prisma.payroll.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            kode: true,
            nama: true,
            role: true,
            tipePerhitunganGaji: true,
            tarifPerJam: true,
            storeId: true,
            store: { select: { id: true, nama: true } },
          },
        },
      },
    });

    if (!payroll) {
      return NextResponse.json({ error: "Payroll tidak ditemukan." }, { status: 404 });
    }

    // RBAC: KARYAWAN & KEPALA_TOKO hanya bisa lihat payroll sendiri
    const isManagerOrAbove = ["DIREKTUR", "MANAJER", "SUPERVISOR", "ADMIN"].includes(session.user.role);
    if (!isManagerOrAbove && payroll.employeeId !== session.user.id) {
      return NextResponse.json({ error: "Tidak berwenang melihat payroll karyawan lain." }, { status: 403 });
    }

    return NextResponse.json({
      id: payroll.id,
      employeeId: payroll.employeeId,
      employee: payroll.employee,
      periode: payroll.periode.toISOString(),
      gajiPokok: payroll.gajiPokok,
      totalHariKerja: payroll.totalHariKerja,
      totalBonusAgenda: payroll.totalBonusAgenda,
      totalPotonganTelat: payroll.totalPotonganTelat,
      bonusManual: payroll.bonusManual,
      potonganManual: payroll.potonganManual,
      bonusPerforma: payroll.bonusPerforma,
      keteranganBonusPerforma: payroll.keteranganBonusPerforma,
      totalGaji: payroll.totalGaji,
      status: payroll.status,
      lockedAt: payroll.lockedAt?.toISOString() ?? null,
      lockedById: payroll.lockedById ?? null,
      createdAt: payroll.createdAt.toISOString(),
      updatedAt: payroll.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("GET /api/payroll/[id] error:", err);
    return NextResponse.json({ error: "Gagal mengambil detail payroll." }, { status: 500 });
  }
}

// PATCH /api/payroll/[id] — Update field manual (bonusManual, potonganManual, bonusPerforma, keteranganBonusPerforma)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya MANAJER yang boleh mengupdate payroll." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: PatchBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    // Validasi input
    let bonusManual: number | null = null;
    let potonganManual: number | null = null;
    let bonusPerforma: number | null = null;
    let keteranganBonusPerforma: string | null = null;

    try {
      bonusManual = validateNonNegativeInt(body.bonusManual, "bonusManual");
      potonganManual = validateNonNegativeInt(body.potonganManual, "potonganManual");
      bonusPerforma = validateNonNegativeInt(body.bonusPerforma, "bonusPerforma");
      keteranganBonusPerforma = validateOptionalString(body.keteranganBonusPerforma, "keteranganBonusPerforma");
    } catch (e) {
      if (e instanceof Error) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });
    }

    // Tidak ada field yang diupdate
    if (bonusManual === null && potonganManual === null && bonusPerforma === null && keteranganBonusPerforma === null) {
      return NextResponse.json({ error: "Tidak ada field yang diupdate." }, { status: 400 });
    }

    // Ambil payroll existing
    const existing = await prisma.payroll.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Payroll tidak ditemukan." }, { status: 404 });
    }

    if (existing.status === "LOCKED") {
      return NextResponse.json({ error: "Payroll sudah di-lock, tidak bisa diubah." }, { status: 403 });
    }

    // Hitung nilai baru
    const newBonusManual = bonusManual ?? existing.bonusManual;
    const newPotonganManual = potonganManual ?? existing.potonganManual;
    const newBonusPerforma = bonusPerforma ?? existing.bonusPerforma;
    const newKeteranganBonusPerforma = keteranganBonusPerforma ?? existing.keteranganBonusPerforma;

    // Recalculate totalGaji
    const baseGaji =
      existing.totalGaji -
      existing.totalBonusAgenda -
      existing.bonusManual -
      existing.bonusPerforma +
      existing.totalPotonganTelat +
      existing.potonganManual;

    const newTotalGaji =
      baseGaji +
      existing.totalBonusAgenda +
      newBonusManual +
      newBonusPerforma -
      existing.totalPotonganTelat -
      newPotonganManual;

    // Update dalam transaction
    const result = await prisma.$transaction(async (tx) => {
      // Simpan nilai sebelum untuk audit
      const nilaiSebelum = {
        id: existing.id,
        bonusManual: existing.bonusManual,
        potonganManual: existing.potonganManual,
        bonusPerforma: existing.bonusPerforma,
        keteranganBonusPerforma: existing.keteranganBonusPerforma,
        totalGaji: existing.totalGaji,
      };

      const updated = await tx.payroll.update({
        where: { id },
        data: {
          bonusManual: newBonusManual,
          potonganManual: newPotonganManual,
          bonusPerforma: newBonusPerforma,
          keteranganBonusPerforma: newKeteranganBonusPerforma,
          totalGaji: newTotalGaji,
        },
      });

      const nilaiSesudah = {
        id: updated.id,
        bonusManual: updated.bonusManual,
        potonganManual: updated.potonganManual,
        bonusPerforma: updated.bonusPerforma,
        keteranganBonusPerforma: updated.keteranganBonusPerforma,
        totalGaji: updated.totalGaji,
      };

      await tx.auditLog.create({
        data: {
          tabel: "Payroll",
          recordId: updated.id,
          aksi: "UPDATE",
          nilaiSebelum,
          nilaiSesudah,
          actorId: session.user.id,
          alasan: "Update manual bonus/potongan/performa",
        },
      });

      return updated;
    });

    return NextResponse.json({
      id: result.id,
      bonusManual: result.bonusManual,
      potonganManual: result.potonganManual,
      bonusPerforma: result.bonusPerforma,
      keteranganBonusPerforma: result.keteranganBonusPerforma,
      totalGaji: result.totalGaji,
      status: result.status,
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/payroll/[id] error:", err);
    return NextResponse.json({ error: "Gagal mengupdate payroll." }, { status: 500 });
  }
}