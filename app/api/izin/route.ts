import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

// Menandai izin: Manajer/Admin/Supervisor saja (Direktur lihat saja).
const MARK_ROLES: Role[] = ["MANAJER", "ADMIN", "SUPERVISOR"];
// Melihat daftar izin: termasuk Direktur.
const VIEW_ROLES: Role[] = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];

const MAX_ALASAN = 200;
const MAX_RANGE_HARI = 31;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODE_RE = /^\d{4}-\d{2}$/;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseTanggal(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const parts = value.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function formatTanggal(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// POST /api/izin — tandai izin (satu tanggal, atau range via tanggalSelesai).
// Body: { employeeId, tanggal: "YYYY-MM-DD", alasan, tanggalSelesai?: "YYYY-MM-DD" }
export async function POST(request: NextRequest) {
  // Diisi di dalam try; dipakai juga di catch P2002 (race condition).
  let tanggalList: Date[] = [];
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!MARK_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json(
        { error: "Hanya Manajer, Admin, atau Supervisor yang dapat menandai izin." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const employeeId = body?.employeeId;
    const alasanRaw = body?.alasan;

    if (typeof employeeId !== "string" || employeeId.length === 0) {
      return NextResponse.json(
        { error: "Field 'employeeId' wajib diisi." },
        { status: 400 }
      );
    }

    const tanggalMulai = parseTanggal(body?.tanggal);
    if (!tanggalMulai) {
      return NextResponse.json(
        { error: "Field 'tanggal' harus format YYYY-MM-DD yang valid." },
        { status: 400 }
      );
    }

    let tanggalSelesai = tanggalMulai;
    if (body?.tanggalSelesai !== undefined && body?.tanggalSelesai !== null) {
      const parsed = parseTanggal(body.tanggalSelesai);
      if (!parsed) {
        return NextResponse.json(
          { error: "Field 'tanggalSelesai' harus format YYYY-MM-DD yang valid." },
          { status: 400 }
        );
      }
      if (parsed.getTime() < tanggalMulai.getTime()) {
        return NextResponse.json(
          { error: "Field 'tanggalSelesai' tidak boleh sebelum 'tanggal'." },
          { status: 400 }
        );
      }
      tanggalSelesai = parsed;
    }

    // Tanggal izin tidak boleh sebelum hari ini (WIB).
    // Konsisten dengan DELETE: data lewat tidak bisa masuk, dan tidak bisa keluar.
    // Karena tanggalSelesai >= tanggalMulai (dicek di atas), cukup cek tanggalMulai.
    const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
    const hariIniWIB = new Date(
      Date.UTC(
        wibNow.getUTCFullYear(),
        wibNow.getUTCMonth(),
        wibNow.getUTCDate()
      )
    );
    if (tanggalMulai.getTime() < hariIniWIB.getTime()) {
      return NextResponse.json(
        { error: "Tidak dapat menandai izin di tanggal yang sudah lewat." },
        { status: 400 }
      );
    }

    const alasan = typeof alasanRaw === "string" ? alasanRaw.trim() : "";
    if (alasan.length === 0) {
      return NextResponse.json(
        { error: "Field 'alasan' wajib diisi." },
        { status: 400 }
      );
    }
    if (alasan.length > MAX_ALASAN) {
      return NextResponse.json(
        { error: `Field 'alasan' maksimal ${MAX_ALASAN} karakter.` },
        { status: 400 }
      );
    }

    const karyawan = await prisma.user.findUnique({
      where: { id: employeeId },
      select: { id: true, status: true },
    });
    if (!karyawan) {
      return NextResponse.json(
        { error: "Karyawan tidak ditemukan." },
        { status: 404 }
      );
    }
    if (karyawan.status === "RESIGN") {
      return NextResponse.json(
        { error: "Karyawan sudah resign, tidak dapat ditandai izin." },
        { status: 400 }
      );
    }

    // Pecah range menjadi record per hari (1 record = 1 tanggal).
    const DAY_MS = 24 * 60 * 60 * 1000;
    tanggalList = [];
    for (
      let t = tanggalMulai.getTime();
      t <= tanggalSelesai.getTime();
      t += DAY_MS
    ) {
      tanggalList.push(new Date(t));
    }
    if (tanggalList.length > MAX_RANGE_HARI) {
      return NextResponse.json(
        { error: `Rentang izin maksimal ${MAX_RANGE_HARI} hari per permintaan.` },
        { status: 400 }
      );
    }

    // Cegah dobel: @@unique([employeeId, tanggal]).
    const existing = await prisma.izin.findMany({
      where: {
        employeeId,
        tanggal: { gte: tanggalMulai, lte: tanggalSelesai },
      },
      select: { tanggal: true },
    });
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: "Sudah ada izin pada tanggal tersebut.",
          tanggalBentrok: existing.map((e) => formatTanggal(e.tanggal)),
        },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const tanggal of tanggalList) {
        const izin = await tx.izin.create({
          data: {
            employeeId,
            tanggal,
            alasan,
            createdById: session.user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            tabel: "Izin",
            recordId: izin.id,
            aksi: "CREATE",
            nilaiSesudah: {
              id: izin.id,
              employeeId: izin.employeeId,
              tanggal: izin.tanggal.toISOString(),
              alasan: izin.alasan,
            },
            actorId: session.user.id,
          },
        });
        items.push(izin);
      }
      return items;
    });

    return NextResponse.json(
      {
        items: created.map((i) => ({
          id: i.id,
          employeeId: i.employeeId,
          tanggal: formatTanggal(i.tanggal),
          alasan: i.alasan,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    // Race condition: dua request konkuren lolos pre-check di atas,
    // yang kedua gagal di @@unique([employeeId, tanggal]) → tetap 409, bukan 500.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "Sudah ada izin pada tanggal tersebut (dibuat proses lain).",
          tanggalBentrok: tanggalList.map(formatTanggal),
        },
        { status: 409 }
      );
    }
    console.error("POST /api/izin error:", err);
    return NextResponse.json(
      { error: "Gagal menandai izin. Silakan coba lagi." },
      { status: 500 }
    );
  }
}

// GET /api/izin?periode=YYYY-MM&storeId=&employeeId= — daftar izin.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!VIEW_ROLES.includes(session.user.role as Role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar izin." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const periodeParam = searchParams.get("periode");
    const storeIdParam = searchParams.get("storeId");
    const employeeIdParam = searchParams.get("employeeId");

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

    const items = await prisma.izin.findMany({
      where: {
        tanggal: { gte: awalBulan, lt: akhirBulan },
        ...(employeeIdParam ? { employeeId: employeeIdParam } : {}),
        ...(storeIdParam ? { employee: { storeId: storeIdParam } } : {}),
      },
      orderBy: { tanggal: "asc" },
      include: {
        employee: {
          select: {
            nama: true,
            kode: true,
            store: { select: { nama: true } },
          },
        },
        createdBy: { select: { nama: true } },
      },
    });

    return NextResponse.json({
      periode,
      total: items.length,
      items: items.map((i) => ({
        id: i.id,
        employeeId: i.employeeId,
        employeeNama: i.employee.nama,
        kode: i.employee.kode,
        storeNama: i.employee.store?.nama ?? null,
        tanggal: formatTanggal(i.tanggal),
        alasan: i.alasan,
        createdByNama: i.createdBy?.nama ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /api/izin error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar izin. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
