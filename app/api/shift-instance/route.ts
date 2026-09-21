import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

function parseTanggalUTC(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

// GET /api/shift-instance?storeId=X&tanggalDari=YYYY-MM-DD&tanggalSampai=YYYY-MM-DD&statusJadwal=DRAFT&batchId=xxx
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengakses jadwal." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    const tanggalDari = url.searchParams.get("tanggalDari");
    const tanggalSampai = url.searchParams.get("tanggalSampai");
    const statusJadwalRaw = url.searchParams.get("statusJadwal");
    const batchId = url.searchParams.get("batchId");

    if (!storeId) {
      return NextResponse.json({ error: "Query 'storeId' wajib diisi" }, { status: 400 });
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    let statusJadwal: "DRAFT" | "APPROVED" | undefined;
    if (statusJadwalRaw !== null) {
      if (statusJadwalRaw !== "DRAFT" && statusJadwalRaw !== "APPROVED") {
        return NextResponse.json(
          { error: "Query 'statusJadwal' harus 'DRAFT' atau 'APPROVED'" },
          { status: 400 }
        );
      }
      statusJadwal = statusJadwalRaw;
    }

    let tanggalFilter: { gte?: Date; lte?: Date } | undefined;
    if (tanggalDari) {
      const d = parseTanggalUTC(tanggalDari);
      if (!d) {
        return NextResponse.json(
          { error: "Format 'tanggalDari' tidak valid (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      tanggalFilter = { ...tanggalFilter, gte: d };
    }
    if (tanggalSampai) {
      const d = parseTanggalUTC(tanggalSampai);
      if (!d) {
        return NextResponse.json(
          { error: "Format 'tanggalSampai' tidak valid (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      tanggalFilter = { ...tanggalFilter, lte: d };
    }

    const instances = await prisma.shiftInstance.findMany({
      where: {
        storeId,
        ...(tanggalFilter ? { tanggal: tanggalFilter } : {}),
        ...(statusJadwal ? { statusJadwal } : {}),
        ...(batchId ? { batchId } : {}),
      },
      orderBy: [{ tanggal: "asc" }, { jamMulai: "asc" }],
      include: {
        template: {
          select: {
            nama: true,
            jamMulaiMenit: true,
            jamSelesaiMenit: true,
            lintasHari: true,
          },
        },
        approvedBy: { select: { nama: true } },
        assignments: {
          orderBy: { createdAt: "asc" },
          include: {
            employee: { select: { nama: true } },
          },
        },
      },
    });

    return NextResponse.json({
      instances: instances.map((x) => ({
        id: x.id,
        storeId: x.storeId,
        templateId: x.templateId,
        template: x.template
          ? {
              nama: x.template.nama,
              jamMulaiMenit: x.template.jamMulaiMenit,
              jamSelesaiMenit: x.template.jamSelesaiMenit,
              lintasHari: x.template.lintasHari,
            }
          : null,
        tanggal: x.tanggal.toISOString().slice(0, 10),
        jamMulai: x.jamMulai.toISOString(),
        jamSelesai: x.jamSelesai.toISOString(),
        statusJadwal: x.statusJadwal,
        sumberJadwal: x.sumberJadwal,
        batchId: x.batchId,
        catatan: x.catatan,
        approvedByName: x.approvedBy?.nama ?? null,
        approvedAt: x.approvedAt ? x.approvedAt.toISOString() : null,
        assignments: x.assignments.map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          employeeNama: a.employee.nama,
          segmen: a.segmen,
          jamMulai: a.jamMulai.toISOString(),
          jamSelesai: a.jamSelesai.toISOString(),
        })),
      })),
    });
  } catch (err) {
    console.error("GET /api/shift-instance error:", err);
    return NextResponse.json(
      { error: "Gagal memuat daftar jadwal." },
      { status: 500 }
    );
  }
}
