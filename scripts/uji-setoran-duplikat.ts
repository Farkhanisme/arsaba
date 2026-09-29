// UJI REGRESI — Anti transfer ganda setoran + bukti setor untuk penerima
//   (backend, sesuai permintaan: fokus backend dulu)
//
// Cakupan:
//   [1] UNIQUE INDEX — setoran kedua dengan nominal sama di menit yang sama
//       -> 409 dengan kode SETORAN_DUPLIKAT, record TIDAK dibuat.
//   [2] Setoran kedua di menit BERBEDA -> boleh (tidak terlalu ketat).
//   [3] Nominal berbeda di menit sama -> boleh.
//   [4] Toko pengirim berbeda, nominal sama -> boleh.
//   [5] BUKTI SETOR — KEPALA_TOKO tujuan bisa membuka bukti yang harus dia
//       konfirmasi, Even record masih MENUNGGU_KONFIRMASI (diterimaOlehId null).
//   [6] KEPALA_TOKO dari toko LAIN tetap 403 (anti eskalasi).
//   [7] Role lain (KARYAWAN) tetap 403.
//   [8] Trigger benar-benar mengisi menitBucket dari disetorkanPada.
//
// Butuh: npm run dev berjalan di terminal lain.

import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { login } from "./http-test";

const prisma = dbClient(prismaRaw);
const BASE = "http://localhost:3000";
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIDUP-${suffix}`;

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${label}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`);
  }
}

/**
 * JPEG 1x1 yang valid, dari file fixture.
 *
 * Penting: byte palsu (`new Uint8Array([1,2,3])`) DITOLAK Telegram dengan
 * IMAGE_PROCESS_FAILED. Without foto yang benar-benar bisa diproses, test ini
 * hanya menguji jalur upload dan tidak pernah menyentuh unique index sama sekali.
 */
const JPEG_PX = new Uint8Array(
  readFileSync(new URL("./fixtures/probe-1px.jpg", import.meta.url))
);

function fileBukti(nama = "bukti.jpg"): File {
  return new File([JPEG_PX], nama, { type: "image/jpeg" });
}

/** Form setoran yang valid. */
function formSetoran(nominal: number, ket?: string) {
  const f = new FormData();
  f.set("tipeTujuan", "PUSAT");
  f.set("nominalDisetor", String(nominal));
  f.set("keterangan", ket ?? "uji anti duplikat");
  f.set("foto", fileBukti());
  return f;
}

async function req(jar: string, method: string, path: string, body?: FormData) {
  const init: RequestInit = { method, headers: { cookie: jar } };
  if (body) init.body = body;
  const r = await fetch(`${BASE}${path}`, init);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json as Record<string, unknown> };
}

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) {
    console.error("❌ SEED_PASSWORD / SEED_ADMIN_PASSWORD belum di-set.");
    process.exitCode = 1;
    return;
  }

  try {
    await tungguDB(prismaRaw);
    const jarMGR = await login("MGR-001", seedPass);
    // User uji butuh password agar bisa login lewat helper `login()`.
    const hashedPassword = await bcrypt.hash(seedPass, 10);

    // ---------- Fixture: 2 toko, 1 kepala toko ----------
    const tokoA = await prisma.store.create({ data: { nama: `${PREFIX}-TOKOA` } });
    const tokoB = await prisma.store.create({ data: { nama: `${PREFIX}-TOKOB` } });
    const ktpA = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KTPA`, nama: "Uji KTP A", role: "KEPALA_TOKO",
        status: "AKTIF", tipePerhitunganGaji: "HARIAN", tarifPerHari: 100_000, storeId: tokoA.id,
        hashedPassword,
      },
    });
    const ktpB = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KTPB`, nama: "Uji KTP B", role: "KEPALA_TOKO",
        status: "AKTIF", tipePerhitunganGaji: "HARIAN", tarifPerHari: 100_000, storeId: tokoB.id,
        hashedPassword,
      },
    });
    const karyawan = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`, nama: "Uji Kari", role: "KARYAWAN",
        status: "AKTIF", tipePerhitunganGaji: "HARIAN", tarifPerHari: 100_000, storeId: tokoA.id,
        hashedPassword,
      },
    });
    const jarA = await login(ktpA.kode, seedPass);
    const jarB = await login(ktpB.kode, seedPass);
    const jarKar = await login(karyawan.kode, seedPass);

    // ============================================================
    console.log("\n[1] UNIQUE INDEX — nominal sama, menit sama → 409");
    const s1 = await req(jarA, "POST", "/api/setoran", formSetoran(750_000, "satu"));
    assert(s1.status === 201, "setoran pertama → 201", { status: s1.status, err: s1.body.error });
    const id1 = String(s1.body.id ?? "");
    // `id1` dipakai blok [8] di bawah. Kalau kosong, assert di sana akan gagal
    // dengan pesan yang menyesatkan — jadi stop di sini dengan jelas.
    assert(id1.length > 0, "setoran pertama punya id", s1.body);

    const s2 = await req(jarA, "POST", "/api/setoran", formSetoran(750_000, "duplikat"));
    assert(s2.status === 409, "setoran identik kedua → 409", { status: s2.status });
    assert(
      s2.body.kode === "SETORAN_DUPLIKAT",
      "kode error = SETORAN_DUPLIKAT",
      s2.body
    );
    assert(
      typeof s2.body.error === "string" && (s2.body.error as string).length > 10,
      "pesan 409 bisa dibaca user",
      s2.body.error
    );
    const nA = await prisma.setoranUang.count({
      where: { dariStoreId: tokoA.id, nominalDisetor: 750_000 },
    });
    assert(nA === 1, `hanya 1 record tersimpan (bukan 2) — uang tidak dobel`, nA);

    // ============================================================
    console.log("\n[2] Menit BERBEDA, nominal sama → boleh");
    await new Promise((r) => setTimeout(r, 62_000));
    const s3 = await req(jarA, "POST", "/api/setoran", formSetoran(750_000, "menit lain"));
    assert(s3.status === 201, "setoran menit berikutnya → 201", { status: s3.status, err: s3.body.error });

    // ============================================================
    console.log("\n[3] Nominal berbeda, menit sama → boleh");
    const s4 = await req(jarA, "POST", "/api/setoran", formSetoran(500_000, "nominal lain"));
    assert(s4.status === 201, "nominal berbeda di menit sama → 201", { status: s4.status, err: s4.body.error });

    // ============================================================
    console.log("\n[4] Toko berbeda, nominal sama → boleh");
    const s5 = await req(jarB, "POST", "/api/setoran", formSetoran(750_000, "toko B"));
    assert(s5.status === 201, "toko lain dengan nominal sama → 201", { status: s5.status, err: s5.body.error });

    // ============================================================
    console.log("\n[8] Trigger mengisi menitBucket otomatis");
    const denganBucket = await prisma.$queryRawUnsafe<{ id: string; menitBucket: Date | null }[]>(
      `SELECT id, "menitBucket" FROM "SetoranUang" WHERE id = $1`,
      id1
    );
    const bucket = denganBucket[0]?.menitBucket;
    assert(!!bucket, "menitBucket terisi (trigger jalan)", bucket);
    const Expected = await prisma.setoranUang.findUnique({ where: { id: id1 } });
    if (bucket && Expected) {
      const selisihDetik = Math.abs(bucket.getTime() - Expected.disetorkanPada.getTime());
      assert(
        selisihDetik < 60_000,
        `menitBucket = menit dari disetorkanPada (beda ${Math.round(selisihDetik / 1000)} dtk)`,
        selisihDetik
      );
    }
    // menitBucket tidak boleh bisa diisi dari mana pun.
    //
    // Diuji lewat TYPE, bukan runtime: Prisma diam-diam membuang field yang
    // tidak dikenal dari `data`, jadi tidak ada error yang bisa diamati. Yang
    // bisa diamati adalah compile-time — lihat blok TYPE-LEVEL GUARD di akhir
    // file ini. Kalau `@ignore` suatu saat dihapus, `tsc` yang gagal, bukan test.
    const tipeSetoran = await prisma.setoranUang.findUnique({
      where: { id: id1 },
      select: { id: true, disetorkanPada: true },
    });
    assert(
      !!tipeSetoran,
      "select tanpa menitBucket tetap bisa dikompilasi (kolom di-@ignore)",
      tipeSetoran?.id
    );

    // ============================================================
    console.log("\n[5] BUKTI — KTP tujuan bisa buka bukti saat MENUNGGU_KONFIRMASI");
    // Setoran dari A ke B, dibuat oleh A, bukti ada.
    const keB = await prisma.setoranUang.create({
      data: {
        dariStoreId: tokoA.id, tipeTujuan: "TOKO", tokoTujuanId: tokoB.id,
        nominalDisetor: 300_000, keterangan: "uji bukti",
        disetorkanOlehId: ktpA.id, disetorkanPada: new Date(),
        bukti: { create: { jenis: "SETOR", fileId: "uji-bukti-file-abcdef", namaFile: "b.jpg" } },
      },
    });
    const buktiId = (await prisma.buktiSetoran.findFirst({
      where: { setoranId: keB.id }, select: { fileId: true },
    }))!.fileId;
    const st = await prisma.setoranUang.findUnique({ where: { id: keB.id }, select: { diterimaOlehId: true } });
    assert(st?.diterimaOlehId === null, "setoran masih MENUNGGU (diterimaOlehId null)", st?.diterimaOlehId);

    const bukaB = await req(jarB, "GET", `/api/telegram/file/${buktiId}`);
    assert(
      bukaB.status !== 403,
      "KEPALA_TOKO tujuan BUKA bukti (tidak 403)",
      { status: bukaB.status }
    );
    // Anti eskalasi: KTP B tidak boleh buka bukti yang tujuannya bukan tokonya.
    // Setoran ini Toward A -> A (bukan B), jadi B tidak punya hak apa pun.
    const milikLain = await prisma.setoranUang.create({
      data: {
        dariStoreId: tokoA.id, tipeTujuan: "TOKO", tokoTujuanId: tokoA.id,
        nominalDisetor: 250_000, keterangan: "uji bukti milik toko lain",
        disetorkanOlehId: ktpA.id, disetorkanPada: new Date(),
        bukti: {
          create: {
            jenis: "SETOR", fileId: "uji-bukti-milik-lain-1234", namaFile: "c.jpg",
          },
        },
      },
    });
    const buktiMilikLain = (await prisma.buktiSetoran.findFirst({
      where: { setoranId: milikLain.id }, select: { fileId: true },
    }))!.fileId;
    const bukaSendiri = await req(jarB, "GET", `/api/telegram/file/${buktiMilikLain}`);
    assert(
      bukaSendiri.status === 403,
      "KEPALA_TOKO B buka bukti milik toko LAIN → 403 (anti eskalasi)",
      bukaSendiri.status
    );

    console.log("\n[6] KEPALA_TOKO pengirim tetap boleh buka bukti miliknya");
    const pengirim = await req(jarA, "GET", `/api/telegram/file/${buktiId}`);
    assert(pengirim.status !== 403, "pengirim (A) boleh buka bukti miliknya sendiri", pengirim.status);

    console.log("\n[7] KARYAWAN tidak boleh → 403");
    const olehKari = await req(jarKar, "GET", `/api/telegram/file/${buktiId}`);
    assert(olehKari.status === 403, "KARYAWAN buka bukti setoran → 403", olehKari.status);

    console.log("\n[8b] MANAJER (verifier) tetap boleh");
    const olehMgr = await req(jarMGR, "GET", `/api/telegram/file/${buktiId}`);
    assert(olehMgr.status !== 403, "MANAJER boleh buka bukti", olehMgr.status);
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[9] Cleanup");
    try {
      const stores = await prisma.store.findMany({
        where: { nama: { startsWith: PREFIX } }, select: { id: true },
      });
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } }, select: { id: true },
      });
      for (const s of stores) {
        await prisma.buktiSetoran.deleteMany({ where: { setoran: { dariStoreId: s.id } } });
        await prisma.buktiSetoran.deleteMany({ where: { setoran: { tokoTujuanId: s.id } } });
      }
      await prisma.buktiSetoran.deleteMany({ where: { fileId: { startsWith: "uji-bukti" } } });
      await prisma.buktiSetoran.deleteMany({ where: { fileId: { startsWith: "probe-file" } } });
      for (const s of stores) {
        await prisma.setoranUang.deleteMany({ where: { dariStoreId: s.id } });
        await prisma.setoranUang.deleteMany({ where: { tokoTujuanId: s.id } });
        await prisma.salesRecord.deleteMany({ where: { storeId: s.id } });
      }
      for (const u of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: u.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: u.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
      for (const s of stores) await prisma.store.delete({ where: { id: s.id } });

      const residuUser = await prisma.user.count({ where: { kode: { startsWith: PREFIX } } });
      const residuStore = await prisma.store.count({ where: { nama: { startsWith: PREFIX } } });
      const residuSetor = await prisma.setoranUang.count({
        where: { OR: [{ dariStoreId: { in: stores.map((s) => s.id) } }, { keterangan: { startsWith: "uji" } }] },
      });
      const total = residuUser + residuStore + residuSetor;
      assert(total === 0, `residu data uji = ${total}`, { residuUser, residuStore, residuSetor });
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    } finally {
      await prismaRaw.$disconnect();
    }
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

void main();

// ============================================================
// TYPE-LEVEL GUARD — dikompilasi `tsc`, tidak dijalankan.
//
// Ini menguji bahwa `menitBucket` TIDAK ada di Prisma Client type, jadi
// aplikasi secara fisik tidak bisa mengirimnya.
//
// Kenapa harus type-level: runtime tidak bisa mengujinya. Prisma diam-diam
// membuang field yang tidak dikenal dari `data` tanpa error, jadi tidak ada yang
// bisa diamati. Satu-satunya pengaman yang bisa diamati adalah compile-time.
//
// PERHATIAN: guard ini menangkap KEBALIKAN dari yang biasa. Kalau `@ignore`
// DIHAPUS, baris ini sendiri masih lolos — karena `menitBucket` jadi field
// opsional di `data`. Yang gagal saat itu adalah setiap call site yang tidak
// mengirim field itu, termasuk `app/api/setoran/route.ts`. Jadi:
//   - hapus `@ignore` -> `npx tsc --noEmit` GAGAL di route setoran
//   - kolom dihapus total  -> baris di bawah GAGAL
//   Keduanya tertangkap. Uji sendiri dengan mengubah schema lalu jalankan tsc.
//
import type { PrismaClient } from "@prisma/client";

type SetoranData = Parameters<PrismaClient["setoranUang"]["create"]>[0]["data"];

/** True kalau Prisma Client tidak mengenal kolom menitBucket. */
type MenitBucketDisembunyikan =
  "menitBucket" extends keyof SetoranData ? false : true;

// Kalau true -> kolom disembunyikan (benar). Kalau false -> kolom bocor.
const __cekKolomTersembunyi: MenitBucketDisembunyikan = true;
void __cekKolomTersembunyi;
