import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getLaporanKehadiran } from "@/lib/laporan-kehadiran";

// Laporan kehadiran lintas toko untuk audit.
// Boleh: DIREKTUR, MANAJER, ADMIN, SUPERVISOR.
const CROSS_STORE_ROLES: Role[] = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];

const PERIODE_RE = /^\d{4}-\d{2}$/;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// GET /api/laporan/kehadiran?periode=YYYY-MM&storeId=...
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
    const periodeParam = searchParams.get("periode");
    const storeIdParam = searchParams.get("storeId");

    // Default ke bulan berjalan (WIB).
    const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
    const defaultPeriode = `${wibNow.getUTCFullYear()}-${String(
      wibNow.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    const periode = periodeParam ?? defaultPeriode;

    if (!PERIODE_RE.test(periode)) {
      return NextResponse.json(
        { error: "Format periode harus YYYY-MM (contoh: 2026-09)." },
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

    const laporan = await getLaporanKehadiran({
      periode,
      awalBulan,
      akhirBulan,
      storeId: storeIdParam,
    });
    return NextResponse.json(laporan);
  } catch (err) {
    console.error("GET /api/laporan/kehadiran error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil laporan kehadiran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
