import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["KARYAWAN", "KEPALA_TOKO", "SUPERVISOR", "ADMIN"];
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// GET /api/absensi/riwayat
// Query: ?limit=30
// Riwayat absensi MILIK SENDIRI saja — tidak menerima parameter employeeId
// supaya tidak ada yang bisa membaca absensi orang lain lewat IDOR.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak melakukan absensi." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
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

    const items = await prisma.attendance.findMany({
      where: { employeeId: session.user.id },
      orderBy: { absenMasuk: "desc" },
      take: limit,
      select: {
        id: true,
        tanggalShift: true,
        absenMasuk: true,
        absenKeluar: true,
        statusMasuk: true,
        statusKeluar: true,
        menitTelat: true,
        potongan: true,
        totalMenitKerja: true,
        totalMenitManual: true,
        autoClosed: true,
        isPam: true,
        logs: {
          // DESC supaya log pertama per jenis = log terbaru (foto koreksi).
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            jenis: true,
            status: true,
            fotoFileId: true,
            latitude: true,
            longitude: true,
            rejectedReason: true,
            // Penting: membedakan foto saat check-in dari foto koreksi
            // (di-upload ulang setelah penolakan).
            keteranganKoreksi: true,
          },
        },
      },
    });

    return NextResponse.json({
      total: items.length,
      items: items.map((a) => {
        // logs diurutkan createdAt DESC, jadi find() mengambil log TERBARU —
        // itu yang benar: kalau karyawan sudah resubmit, foto terbaru adalah
        // foto koreksi yang sedang menunggu verifikasi, bukan foto lama.
        const logMasuk = a.logs.find((l) => l.jenis === "MASUK") ?? null;
        const logKeluar = a.logs.find((l) => l.jenis === "KELUAR") ?? null;
        return {
          id: a.id,
          tanggalShift: a.tanggalShift.toISOString().slice(0, 10),
          absenMasuk: a.absenMasuk.toISOString(),
          absenKeluar: a.absenKeluar ? a.absenKeluar.toISOString() : null,
          statusMasuk: a.statusMasuk,
          statusKeluar: a.statusKeluar,
          menitTelat: a.menitTelat,
          potongan: a.potongan,
          totalMenitKerja: a.totalMenitKerja,
          totalMenitManual: a.totalMenitManual,
          autoClosed: a.autoClosed,
          isPam: a.isPam,
          // Alasan penolakan paling relevan untuk karyawan.
          rejectedReason:
            logMasuk?.rejectedReason ?? logKeluar?.rejectedReason ?? null,
          logMasuk: logMasuk
            ? {
                fotoFileId: logMasuk.fotoFileId,
                latitude: logMasuk.latitude,
                longitude: logMasuk.longitude,
                keteranganKoreksi: logMasuk.keteranganKoreksi,
              }
            : null,
          logKeluar: logKeluar
            ? {
                fotoFileId: logKeluar.fotoFileId,
                latitude: logKeluar.latitude,
                longitude: logKeluar.longitude,
                keteranganKoreksi: logKeluar.keteranganKoreksi,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("GET /api/absensi/riwayat error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil riwayat absensi." },
      { status: 500 }
    );
  }
}
