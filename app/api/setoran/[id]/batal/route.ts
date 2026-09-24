import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import {
  MAX_KETERANGAN,
  prisma,
  serializeSetoran,
  setoranInclude,
  type SetoranDenganRelasi,
} from "@/lib/setoran";

// POST /api/setoran/[id]/batal — batalkan setoran (koreksi sebelum diterima).
// Hanya pengirim (KEPALA_TOKO pembuat), hanya dari status MENUNGGU_KONFIRMASI.
// Body JSON: { "alasan": string } (wajib, max 200).
// Transisi status atomik via updateMany ber-kondisi (guard race batal-vs-terima
// konkuren) — lihat komentar di dalam transaksi.
const STATUS_CONFLICT = "SETORAN_STATUS_CONFLICT";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if ((session.user.role as Role) !== "KEPALA_TOKO") {
      return NextResponse.json(
        { error: "Hanya Kepala Toko yang dapat membatalkan setoran." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const record = await prisma.setoranUang.findUnique({
      where: { id },
      select: { id: true, disetorkanOlehId: true, status: true },
    });
    if (!record) {
      return NextResponse.json(
        { error: "Data setoran tidak ditemukan." },
        { status: 404 }
      );
    }
    if (record.disetorkanOlehId !== session.user.id) {
      return NextResponse.json(
        { error: "Hanya pembuat setoran yang dapat membatalkannya." },
        { status: 403 }
      );
    }
    if (record.status !== "MENUNGGU_KONFIRMASI") {
      return NextResponse.json(
        { error: "Setoran ini sudah tidak bisa dibatalkan." },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => null);
    const alasanRaw = body?.alasan;
    if (typeof alasanRaw !== "string" || alasanRaw.trim().length === 0) {
      return NextResponse.json(
        { error: "Field 'alasan' wajib diisi." },
        { status: 400 }
      );
    }
    if (alasanRaw.trim().length > MAX_KETERANGAN) {
      return NextResponse.json(
        { error: `Field 'alasan' maksimal ${MAX_KETERANGAN} karakter.` },
        { status: 400 }
      );
    }
    const alasanBatal = alasanRaw.trim();

    const now = new Date();
    const updated = (await prisma.$transaction(async (tx) => {
      // Guard atomik: hanya MENUNGGU_KONFIRMASI yang boleh bertransisi.
      // 0 baris ter-update berarti status sudah berubah (request konkuren
      // menang — mis. penerima mengonfirmasi bersamaan), dipetakan ke 409.
      const transisi = await tx.setoranUang.updateMany({
        where: { id: record.id, status: "MENUNGGU_KONFIRMASI" },
        data: {
          status: "DIBATALKAN",
          batalOlehId: session.user.id,
          batalPada: now,
          alasanBatal,
        },
      });
      if (transisi.count !== 1) {
        throw new Error(STATUS_CONFLICT);
      }

      const setoran = await tx.setoranUang.findUnique({
        where: { id: record.id },
        include: setoranInclude,
      });
      if (!setoran) {
        throw new Error(STATUS_CONFLICT);
      }

      await tx.auditLog.create({
        data: {
          tabel: "SetoranUang",
          recordId: setoran.id,
          aksi: "UPDATE",
          nilaiSesudah: {
            id: setoran.id,
            status: setoran.status,
            alasanBatal: setoran.alasanBatal,
            batalPada: setoran.batalPada?.toISOString() ?? null,
          },
          actorId: session.user.id,
        },
      });

      return setoran;
    })) as SetoranDenganRelasi;

    return NextResponse.json(serializeSetoran(updated));
  } catch (err) {
    console.error("POST /api/setoran/[id]/batal error:", err);
    if (err instanceof Error && err.message === STATUS_CONFLICT) {
      return NextResponse.json(
        { error: "Setoran ini sudah tidak bisa dibatalkan." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Gagal membatalkan setoran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
