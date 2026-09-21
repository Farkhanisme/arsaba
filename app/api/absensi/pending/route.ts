import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/absensi/pending
// Query: ?storeId=xxx&limit=50
// List absensi dengan statusMasuk atau statusKeluar = PENDING_VERIFIKASI.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar verifikasi." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const storeIdParam = searchParams.get("storeId");
    const limitParam = searchParams.get("limit");

    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return NextResponse.json(
          { error: `Field 'limit' harus integer 1-${MAX_LIMIT}.` },
          { status: 400 }
        );
      }
      limit = parsed;
    }

    const where: Record<string, unknown> = {
      OR: [
        { statusMasuk: "PENDING_VERIFIKASI" },
        { statusKeluar: "PENDING_VERIFIKASI" },
      ],
    };
    if (storeIdParam) {
      where.storeId = storeIdParam;
    }

    const items = await prisma.attendance.findMany({
      where,
      orderBy: { absenMasuk: "desc" },
      take: limit,
      include: {
        employee: { select: { nama: true } },
        store: { select: { nama: true } },
        logs: {
          orderBy: { createdAt: "desc" },
          select: {
            jenis: true,
            fotoFileId: true,
            latitude: true,
            longitude: true,
            absenServerPada: true,
          },
        },
      },
    });

    const result = await Promise.all(
      items.map(async (att) => {
        const jadwal = await prisma.shiftAssignment.findMany({
          where: {
            employeeId: att.employeeId,
            shiftInstance: {
              tanggal: att.tanggalShift,
              statusJadwal: "APPROVED",
            },
          },
          select: {
            segmen: true,
            jamMulai: true,
            jamSelesai: true,
          },
        });

        const logMasuk = att.logs.find((l) => l.jenis === "MASUK") ?? null;
        const logKeluar = att.logs.find((l) => l.jenis === "KELUAR") ?? null;

        return {
          id: att.id,
          employeeNama: att.employee.nama,
          storeNama: att.store.nama,
          tanggalShift: att.tanggalShift.toISOString().slice(0, 10),
          absenMasuk: att.absenMasuk.toISOString(),
          absenKeluar: att.absenKeluar ? att.absenKeluar.toISOString() : null,
          statusMasuk: att.statusMasuk,
          statusKeluar: att.statusKeluar,
          menitTelat: att.menitTelat,
          potongan: att.potongan,
          isPam: att.isPam,
          autoClosed: att.autoClosed,
          logMasuk: logMasuk
            ? {
                fotoFileId: logMasuk.fotoFileId,
                latitude: logMasuk.latitude,
                longitude: logMasuk.longitude,
                absenServerPada: logMasuk.absenServerPada.toISOString(),
              }
            : null,
          logKeluar: logKeluar
            ? {
                fotoFileId: logKeluar.fotoFileId,
                latitude: logKeluar.latitude,
                longitude: logKeluar.longitude,
                absenServerPada: logKeluar.absenServerPada.toISOString(),
              }
            : null,
          jadwalAcuan: jadwal.map((j) => ({
            segmen: j.segmen,
            jamMulai: j.jamMulai.toISOString(),
            jamSelesai: j.jamSelesai.toISOString(),
          })),
        };
      })
    );

    return NextResponse.json({
      total: result.length,
      items: result,
    });
  } catch (err) {
    console.error("GET /api/absensi/pending error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar verifikasi. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
