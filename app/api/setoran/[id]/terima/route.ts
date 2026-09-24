import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import {
  MAX_FOTO,
  MAX_KETERANGAN,
  MAX_NOMINAL,
  parseNominal,
  prisma,
  serializeSetoran,
  getFotoFiles,
  setoranInclude,
  uploadBuktiFiles,
  validateFotoFile,
  type SetoranDenganRelasi,
} from "@/lib/setoran";

// POST /api/setoran/[id]/terima — konfirmasi penerimaan setoran.
// - Tujuan TOKO: hanya KEPALA_TOKO dari toko tujuan.
// - Tujuan PUSAT: MANAJER / ADMIN / SUPERVISOR.
// Body multipart/form-data: nominalDiterima, keteranganSelisih?, foto[] (≥1, ≤5).
// Transisi status atomik via updateMany ber-kondisi (guard race terima-vs-terima
// dan terima-vs-batal konkuren) — lihat komentar di dalam transaksi.
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
    const role = session.user.role as Role;

    const { id } = await params;
    const record = await prisma.setoranUang.findUnique({
      where: { id },
      select: { id: true, tipeTujuan: true, tokoTujuanId: true, status: true, nominalDisetor: true },
    });
    if (!record) {
      return NextResponse.json(
        { error: "Data setoran tidak ditemukan." },
        { status: 404 }
      );
    }

    const bolehTerima =
      (record.tipeTujuan === "TOKO" &&
        role === "KEPALA_TOKO" &&
        session.user.storeId !== null &&
        session.user.storeId === record.tokoTujuanId) ||
      (record.tipeTujuan === "PUSAT" && (role === "MANAJER" || role === "ADMIN" || role === "SUPERVISOR"));
    if (!bolehTerima) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengonfirmasi setoran ini." },
        { status: 403 }
      );
    }

    if (record.status !== "MENUNGGU_KONFIRMASI") {
      return NextResponse.json(
        { error: "Setoran ini sudah tidak menunggu konfirmasi." },
        { status: 409 }
      );
    }

    const formData = await request.formData();
    const nominalRaw = formData.get("nominalDiterima");
    const keteranganSelisihRaw = formData.get("keteranganSelisih");

    const nominalDiterima = parseNominal(
      typeof nominalRaw === "string" ? nominalRaw : null
    );
    if (nominalDiterima === null) {
      return NextResponse.json(
        { error: `Field 'nominalDiterima' harus bilangan bulat rupiah 1–${MAX_NOMINAL}.` },
        { status: 400 }
      );
    }

    // Selisih dihitung server — tidak pernah dipercaya dari client.
    const selisih = nominalDiterima - record.nominalDisetor;

    let keteranganSelisih: string | null = null;
    if (typeof keteranganSelisihRaw === "string" && keteranganSelisihRaw.trim().length > 0) {
      if (keteranganSelisihRaw.trim().length > MAX_KETERANGAN) {
        return NextResponse.json(
          { error: `Field 'keteranganSelisih' maksimal ${MAX_KETERANGAN} karakter.` },
          { status: 400 }
        );
      }
      keteranganSelisih = keteranganSelisihRaw.trim();
    }
    if (selisih !== 0 && !keteranganSelisih) {
      return NextResponse.json(
        { error: "Nominal diterima berbeda dari nominal disetor — field 'keteranganSelisih' wajib diisi." },
        { status: 400 }
      );
    }

    const files = getFotoFiles(formData);
    if (files.length < 1) {
      return NextResponse.json(
        { error: "Minimal 1 foto bukti terima wajib dilampirkan." },
        { status: 400 }
      );
    }
    if (files.length > MAX_FOTO) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_FOTO} foto bukti per konfirmasi.` },
        { status: 400 }
      );
    }
    for (const f of files) {
      const errMsg = validateFotoFile(f);
      if (errMsg) {
        return NextResponse.json({ error: errMsg }, { status: 400 });
      }
    }

    const now = new Date();
    const uploaded = await uploadBuktiFiles(files, "setoran-terima");

    const updated = (await prisma.$transaction(async (tx) => {
      // Guard atomik: hanya MENUNGGU_KONFIRMASI yang boleh bertransisi.
      // updateMany mengembalikan count — 0 berarti status sudah berubah
      // (request konkuren menang), dipetakan ke 409 di catch.
      // (updateMany dipakai karena update ber-kondisi; nested create bukti
      // dilakukan terpisah via createMany — updateMany tak mendukung relasi.)
      const transisi = await tx.setoranUang.updateMany({
        where: { id: record.id, status: "MENUNGGU_KONFIRMASI" },
        data: {
          status: "DITERIMA",
          nominalDiterima,
          selisih,
          keteranganSelisih,
          diterimaOlehId: session.user.id,
          diterimaPada: now,
        },
      });
      if (transisi.count !== 1) {
        throw new Error(STATUS_CONFLICT);
      }

      await tx.buktiSetoran.createMany({
        data: uploaded.map((u) => ({
          setoranId: record.id,
          jenis: "TERIMA" as const,
          fileId: u.fileId,
          namaFile: u.namaFile,
        })),
      });

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
            nominalDiterima: setoran.nominalDiterima,
            selisih: setoran.selisih,
            diterimaPada: setoran.diterimaPada?.toISOString() ?? null,
          },
          actorId: session.user.id,
        },
      });

      return setoran;
    })) as SetoranDenganRelasi;

    return NextResponse.json(serializeSetoran(updated));
  } catch (err) {
    console.error("POST /api/setoran/[id]/terima error:", err);
    if (err instanceof Error && err.message === STATUS_CONFLICT) {
      return NextResponse.json(
        { error: "Setoran ini sudah tidak menunggu konfirmasi." },
        { status: 409 }
      );
    }
    if (err instanceof Error && /telegram/i.test(err.message)) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal mengonfirmasi setoran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
