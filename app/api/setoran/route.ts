import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma, Role } from "@prisma/client";
import {
  MAX_FOTO,
  MAX_KETERANGAN,
  MAX_NOMINAL,
  STATUS_VALID,
  parseNominal,
  parsePeriode,
  prisma,
  serializeSetoran,
  getFotoFiles,
  setoranInclude,
  uploadBuktiFiles,
  validateFotoFile,
  type SetoranDenganRelasi,
} from "@/lib/setoran";

// Modul penyetoran uang antar toko & pusat (jejak transfer kas).
// GET: daftar (filter periode/arah/status/toko). POST: buat setoran baru.
const CROSS_STORE_ROLES: Role[] = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];
const ARAH_VALID = ["kirim", "terima", "semua"] as const;

// GET /api/setoran?periode=YYYY-MM&arah=kirim|terima|semua&status=&tokoId=
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const role = session.user.role as Role;
    const isCrossStore = CROSS_STORE_ROLES.includes(role);
    // KARYAWAN tidak punya akses ke modul ini sama sekali.
    if (!isCrossStore && role !== "KEPALA_TOKO") {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat data setoran." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = parsePeriode(searchParams.get("periode"));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { periode, awalBulan, akhirBulan } = parsed;

    const arahParam = searchParams.get("arah") ?? "semua";
    if (!(ARAH_VALID as readonly string[]).includes(arahParam)) {
      return NextResponse.json(
        { error: "Parameter 'arah' harus salah satu dari: kirim, terima, semua." },
        { status: 400 }
      );
    }
    const arah = arahParam as (typeof ARAH_VALID)[number];

    const statusParam = searchParams.get("status");
    if (statusParam !== null && !(STATUS_VALID as readonly string[]).includes(statusParam)) {
      return NextResponse.json(
        { error: "Parameter 'status' tidak valid." },
        { status: 400 }
      );
    }

    const tokoIdParam = searchParams.get("tokoId");

    const where: Prisma.SetoranUangWhereInput = {
      disetorkanPada: { gte: awalBulan, lt: akhirBulan },
    };
    if (statusParam !== null) {
      where.status = statusParam as (typeof STATUS_VALID)[number];
    }

    if (!isCrossStore) {
      // KEPALA_TOKO: hanya transaksi yang melibatkan tokonya
      // (sebagai pengirim ATAU sebagai penerima).
      const storeId = session.user.storeId;
      if (!storeId) {
        return NextResponse.json(
          { error: "Akun ini tidak terhubung ke toko manapun." },
          { status: 400 }
        );
      }
      if (tokoIdParam !== null && tokoIdParam !== storeId) {
        return NextResponse.json(
          { error: "Anda hanya dapat melihat setoran yang melibatkan toko Anda." },
          { status: 403 }
        );
      }
      const kirimClause: Prisma.SetoranUangWhereInput = { dariStoreId: storeId };
      const terimaClause: Prisma.SetoranUangWhereInput = {
        tipeTujuan: "TOKO",
        tokoTujuanId: storeId,
      };
      if (arah === "kirim") Object.assign(where, kirimClause);
      else if (arah === "terima") Object.assign(where, terimaClause);
      else where.OR = [kirimClause, terimaClause];
    } else {
      // Cross-store: semua arah, filter tokoId opsional.
      if (arah === "kirim") {
        if (tokoIdParam !== null) where.dariStoreId = tokoIdParam;
      } else if (arah === "terima") {
        if (tokoIdParam !== null) where.tokoTujuanId = tokoIdParam;
      } else {
        if (tokoIdParam !== null) {
          where.OR = [
            { dariStoreId: tokoIdParam },
            { tokoTujuanId: tokoIdParam },
          ];
        }
      }
    }

    const rows = (await prisma.setoranUang.findMany({
      where,
      include: setoranInclude,
      orderBy: { disetorkanPada: "desc" },
    })) as SetoranDenganRelasi[];

    return NextResponse.json({
      periode,
      arah,
      items: rows.map(serializeSetoran),
    });
  } catch (err) {
    console.error("GET /api/setoran error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil data setoran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}

// POST /api/setoran — buat setoran baru (hanya KEPALA_TOKO, dari tokonya sendiri).
// Body multipart/form-data: tipeTujuan, tokoTujuanId?, nominalDisetor, keterangan?, foto[] (≥1, ≤5).
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if ((session.user.role as Role) !== "KEPALA_TOKO") {
      return NextResponse.json(
        { error: "Hanya Kepala Toko yang dapat membuat setoran." },
        { status: 403 }
      );
    }
    const dariStoreId = session.user.storeId;
    if (!dariStoreId) {
      return NextResponse.json(
        { error: "Akun ini tidak terhubung ke toko manapun, tidak bisa membuat setoran." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const tipeTujuanRaw = formData.get("tipeTujuan");
    const tokoTujuanRaw = formData.get("tokoTujuanId");
    const nominalRaw = formData.get("nominalDisetor");
    const keteranganRaw = formData.get("keterangan");

    if (tipeTujuanRaw !== "TOKO" && tipeTujuanRaw !== "PUSAT") {
      return NextResponse.json(
        { error: "Field 'tipeTujuan' harus 'TOKO' atau 'PUSAT'." },
        { status: 400 }
      );
    }
    const tipeTujuan = tipeTujuanRaw as "TOKO" | "PUSAT";

    let tokoTujuanId: string | null = null;
    if (tipeTujuan === "TOKO") {
      if (typeof tokoTujuanRaw !== "string" || tokoTujuanRaw.length === 0) {
        return NextResponse.json(
          { error: "Field 'tokoTujuanId' wajib diisi untuk tujuan TOKO." },
          { status: 400 }
        );
      }
      if (tokoTujuanRaw === dariStoreId) {
        return NextResponse.json(
          { error: "Tidak bisa setor ke toko sendiri." },
          { status: 400 }
        );
      }
      const tokoTujuan = await prisma.store.findUnique({
        where: { id: tokoTujuanRaw },
        select: { id: true, aktif: true },
      });
      if (!tokoTujuan || !tokoTujuan.aktif) {
        return NextResponse.json(
          { error: "Toko tujuan tidak ditemukan atau tidak aktif." },
          { status: 400 }
        );
      }
      tokoTujuanId = tokoTujuan.id;
    } else {
      if (typeof tokoTujuanRaw === "string" && tokoTujuanRaw.length > 0) {
        return NextResponse.json(
          { error: "Field 'tokoTujuanId' tidak boleh diisi untuk tujuan PUSAT." },
          { status: 400 }
        );
      }
    }

    const nominalDisetor = parseNominal(
      typeof nominalRaw === "string" ? nominalRaw : null
    );
    if (nominalDisetor === null) {
      return NextResponse.json(
        { error: `Field 'nominalDisetor' harus bilangan bulat rupiah 1–${MAX_NOMINAL}.` },
        { status: 400 }
      );
    }

    let keterangan: string | null = null;
    if (typeof keteranganRaw === "string" && keteranganRaw.trim().length > 0) {
      if (keteranganRaw.trim().length > MAX_KETERANGAN) {
        return NextResponse.json(
          { error: `Field 'keterangan' maksimal ${MAX_KETERANGAN} karakter.` },
          { status: 400 }
        );
      }
      keterangan = keteranganRaw.trim();
    }

    const files = getFotoFiles(formData);
    if (files.length < 1) {
      return NextResponse.json(
        { error: "Minimal 1 foto bukti wajib dilampirkan." },
        { status: 400 }
      );
    }
    if (files.length > MAX_FOTO) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_FOTO} foto bukti per setoran.` },
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
    const uploaded = await uploadBuktiFiles(files, "setoran");

    const created = (await prisma.$transaction(async (tx) => {
      const setoran = await tx.setoranUang.create({
        data: {
          dariStoreId,
          tipeTujuan,
          tokoTujuanId,
          nominalDisetor,
          keterangan,
          disetorkanOlehId: session.user.id,
          disetorkanPada: now,
          bukti: {
            create: uploaded.map((u) => ({
              jenis: "SETOR" as const,
              fileId: u.fileId,
              namaFile: u.namaFile,
            })),
          },
        },
        include: setoranInclude,
      });

      await tx.auditLog.create({
        data: {
          tabel: "SetoranUang",
          recordId: setoran.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: setoran.id,
            dariStoreId: setoran.dariStoreId,
            tipeTujuan: setoran.tipeTujuan,
            tokoTujuanId: setoran.tokoTujuanId,
            nominalDisetor: setoran.nominalDisetor,
            disetorkanPada: setoran.disetorkanPada.toISOString(),
          },
          actorId: session.user.id,
        },
      });

      return setoran;
    })) as SetoranDenganRelasi;

    return NextResponse.json(serializeSetoran(created), { status: 201 });
  } catch (err) {
    console.error("POST /api/setoran error:", err);
    if (err instanceof Error && /telegram/i.test(err.message)) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal membuat setoran. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
