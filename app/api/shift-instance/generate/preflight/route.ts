import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const HARI_MS = 24 * 60 * 60 * 1000;

// GET /api/shift-instance/generate/preflight?storeId=X&tanggalMulai=YYYY-MM-DD&jumlahHari=N
// Return: info pre-flight untuk UI (jumlah template, karyawan, kapasitas, konflik tanggal).
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    const tanggalMulaiStr = url.searchParams.get("tanggalMulai");
    const jumlahHariStr = url.searchParams.get("jumlahHari");

    if (!storeId) {
      return NextResponse.json(
        { error: "Query 'storeId' wajib diisi." },
        { status: 400 }
      );
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, nama: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: "Toko tidak ditemukan." },
        { status: 404 }
      );
    }

    const jumlahTemplate = await prisma.shiftTemplate.count({
      where: { storeId, aktif: true },
    });

    const jumlahKaryawan = await prisma.user.count({
      where: {
        storeId,
        status: "AKTIF",
        role: { in: ["KARYAWAN", "KEPALA_TOKO"] },
      },
    });

    const kapasitasPerShift =
      jumlahTemplate > 0 ? Math.floor(jumlahKaryawan / jumlahTemplate) : 0;

    // Cek konflik tanggal kalau tanggalMulai & jumlahHari valid
    let konflik: string[] = [];
    if (tanggalMulaiStr && jumlahHariStr) {
      const jumlahHari = Number(jumlahHariStr);
      if (
        Number.isInteger(jumlahHari) &&
        jumlahHari >= 1 &&
        jumlahHari <= 31
      ) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tanggalMulaiStr);
        if (m) {
          const y = Number(m[1]);
          const mo = Number(m[2]);
          const d = Number(m[3]);
          const tanggalMulai = new Date(Date.UTC(y, mo - 1, d));

          if (
            tanggalMulai.getUTCFullYear() === y &&
            tanggalMulai.getUTCMonth() === mo - 1 &&
            tanggalMulai.getUTCDate() === d
          ) {
            const tanggalList: Date[] = [];
            for (let i = 0; i < jumlahHari; i++) {
              tanggalList.push(new Date(tanggalMulai.getTime() + i * HARI_MS));
            }

            const existing = await prisma.shiftInstance.findMany({
              where: { storeId, tanggal: { in: tanggalList } },
              select: { tanggal: true },
            });
            konflik = existing.map((e) =>
              e.tanggal.toISOString().slice(0, 10)
            );
          }
        }
      }
    }

    return NextResponse.json({
      storeNama: store.nama,
      jumlahTemplate,
      jumlahKaryawan,
      kapasitasPerShift,
      bisaGenerate: jumlahTemplate > 0 && kapasitasPerShift >= 1,
      konflikTanggal: konflik,
    });
  } catch (err) {
    console.error("GET /api/shift-instance/generate/preflight error:", err);
    return NextResponse.json(
      { error: "Gagal memuat info pre-flight." },
      { status: 500 }
    );
  }
}
