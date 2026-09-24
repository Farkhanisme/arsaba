import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getRincianKehadiran } from "@/lib/laporan-kehadiran";

// Rincian kehadiran per tanggal untuk satu karyawan (Scope B.1).
// Boleh: DIREKTUR, MANAJER, ADMIN, SUPERVISOR (sama seperti agregat).
const CROSS_STORE_ROLES: Role[] = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];

const PERIODE_RE = /^\d{4}-\d{2}$/;

// GET /api/laporan/kehadiran/rincian?periode=YYYY-MM&employeeId=...&storeId=...
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!CROSS_STORE_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat laporan kehadiran." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const periode = searchParams.get("periode");
    const employeeId = searchParams.get("employeeId");
    const storeIdParam = searchParams.get("storeId");

    if (!periode || !PERIODE_RE.test(periode)) {
      return NextResponse.json(
        { error: "Format periode harus YYYY-MM (contoh: 2026-09)." },
        { status: 400 }
      );
    }
    if (!employeeId) {
      return NextResponse.json(
        { error: "Parameter employeeId wajib diisi." },
        { status: 400 }
      );
    }
    const [yearStr, monthStr] = periode.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Bulan tidak valid (1-12)." },
        { status: 400 }
      );
    }
    const awalBulan = new Date(Date.UTC(year, month - 1, 1));
    const akhirBulan = new Date(Date.UTC(year, month, 1));

    const rincian = await getRincianKehadiran({
      employeeId,
      periode,
      awalBulan,
      akhirBulan,
      storeId: storeIdParam,
    });
    return NextResponse.json(rincian);
  } catch (err) {
    console.error("GET /api/laporan/kehadiran/rincian error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil rincian kehadiran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
