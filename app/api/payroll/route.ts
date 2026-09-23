import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [
  "DIREKTUR",
  "MANAJER",
  "SUPERVISOR",
  "ADMIN",
  "KEPALA_TOKO",
  "KARYAWAN",
];

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }

    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat payroll." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const periodeParam = searchParams.get("periode"); // "YYYY-MM"
    const statusParam = searchParams.get("status"); // "DRAFT" | "LOCKED"
    const employeeIdParam = searchParams.get("employeeId");

    const isManagerOrAbove = ["DIREKTUR", "MANAJER", "SUPERVISOR", "ADMIN"].includes(session.user.role);

    // Build where clause
    const where: Record<string, unknown> = {};

    // Filter periode
    if (periodeParam) {
      const periodeRegex = /^\d{4}-\d{2}$/;
      if (!periodeRegex.test(periodeParam)) {
        return NextResponse.json({ error: "Format periode harus YYYY-MM." }, { status: 400 });
      }
      const [yearStr, monthStr] = periodeParam.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (month < 1 || month > 12) {
        return NextResponse.json({ error: "Bulan tidak valid." }, { status: 400 });
      }
      const periodeDate = new Date(Date.UTC(year, month - 1, 1));
      where.periode = periodeDate;
    }

    // Filter status
    if (statusParam) {
      if (!["DRAFT", "LOCKED"].includes(statusParam)) {
        return NextResponse.json({ error: "Status harus DRAFT atau LOCKED." }, { status: 400 });
      }
      where.status = statusParam;
    }

    // Filter employeeId - hanya MANAJER ke atas yang boleh filter karyawan lain
    if (employeeIdParam) {
      if (!isManagerOrAbove) {
        return NextResponse.json(
          { error: "Hanya MANAJER ke atas yang boleh filter berdasarkan employeeId." },
          { status: 403 }
        );
      }
      where.employeeId = employeeIdParam;
    } else if (!isManagerOrAbove) {
      // KARYAWAN & KEPALA_TOKO hanya bisa lihat payroll sendiri
      where.employeeId = session.user.id;
    }

    const payrolls = await prisma.payroll.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            kode: true,
            nama: true,
            role: true,
            tipePerhitunganGaji: true,
          },
        },
      },
      orderBy: [{ periode: "desc" }, { employee: { nama: "asc" } }],
    });

    // Transform response
    const items = payrolls.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      employee: p.employee,
      periode: p.periode.toISOString(),
      gajiPokok: p.gajiPokok,
      totalHariKerja: p.totalHariKerja,
      totalBonusAgenda: p.totalBonusAgenda,
      totalPotonganTelat: p.totalPotonganTelat,
      bonusManual: p.bonusManual,
      potonganManual: p.potonganManual,
      bonusPerforma: p.bonusPerforma,
      keteranganBonusPerforma: p.keteranganBonusPerforma,
      totalGaji: p.totalGaji,
      status: p.status,
      lockedAt: p.lockedAt?.toISOString() ?? null,
      lockedById: p.lockedById ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return NextResponse.json({ total: items.length, items });
  } catch (err) {
    console.error("GET /api/payroll error:", err);
    return NextResponse.json({ error: "Gagal mengambil daftar payroll." }, { status: 500 });
  }
}