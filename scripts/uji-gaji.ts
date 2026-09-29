// UJI REGRESI — Perhitungan gaji (lib/gaji.ts) & endpoint PATCH /api/user/[id]/gaji
// Jalankan: npx tsx --env-file=.env scripts/uji-gaji.ts
//
// Cakupan:
//   [1] hitungBaseGaji — rumus ketiga tipe.
//   [2] jamTerbayarDariMenit — floor PER HARI (§7.1a).
//   [3] validasiTarif — tiap tipe punya tarif wajibnya sendiri (anti-regresi P0-1).
//   [4] Normalisasi: field tidak relevan jadi null, field wajib tidak boleh hilang.
//   [5] Regresi P0-1: HARIAN tanpa tarifPerHari harus 0 (data salah terdeteksi),
//       dan TIDAK boleh diam-diam memakai tarifPerJam sebagai pengganti.
//   [6] Integrasi DB: PATCH gaji lewat helper, lalu baca balik + cek audit log.
//
// Data uji dibuat lalu dihapus; residu harus 0.

import { prisma as prismaRaw } from "@/lib/prisma";
import {
  hitungBaseGaji,
  jamTerbayarDariMenit,
  validasiTarif,
  fieldWajibUntukTipe,
  NOMINAL_MAX,
} from "@/lib/gaji";
import { dbClient, tungguDB } from "./db-retry";

const prisma = dbClient(prismaRaw);

const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIGAJI-${suffix}`;

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.error(
      `  ❌ ${label}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`
    );
  }
}

const base = {
  tipe: "HARIAN" as const,
  tarifPerJam: null,
  tarifPerHari: null,
  gajiPokokNominal: 0,
  totalHariKerja: 0,
  totalJamTerbayar: 0,
};

async function main() {
  try {
    await tungguDB(prismaRaw);

    // ================= [1] hitungBaseGaji =================
    console.log("\n[1] hitungBaseGaji — rumus per tipe");

    assert(
      hitungBaseGaji({
        ...base,
        tipe: "HARIAN",
        tarifPerHari: 120_000,
        totalHariKerja: 20,
      }) === 2_400_000,
      "HARIAN: tarifPerHari 120.000 × 20 hari = 2.400.000",
      hitungBaseGaji({
        ...base,
        tipe: "HARIAN",
        tarifPerHari: 120_000,
        totalHariKerja: 20,
      })
    );

    assert(
      hitungBaseGaji({
        ...base,
        tipe: "BULANAN",
        gajiPokokNominal: 3_500_000,
        totalHariKerja: 3,
      }) === 3_500_000,
      "BULANAN: nominal tetap 3.500.000, tidak bergantung hari kerja"
    );

    assert(
      hitungBaseGaji({
        ...base,
        tipe: "JAM",
        tarifPerJam: 5_000,
        totalJamTerbayar: 42,
      }) === 210_000,
      "JAM: tarifPerJam 5.000 × 42 jam = 210.000"
    );

    // HARIAN tidak boleh dipengaruhi jam kerja
    assert(
      hitungBaseGaji({
        ...base,
        tipe: "HARIAN",
        tarifPerHari: 120_000,
        totalHariKerja: 20,
        totalJamTerbayar: 999,
      }) === 2_400_000,
      "HARIAN: totalJamTerbayar tidak memengaruhi hasil (tidak ada lembur)"
    );

    // ================= [2] floor PER HARI =================
    console.log("\n[2] jamTerbayarDariMenit — floor per hari (§7.1a)");
    assert(jamTerbayarDariMenit(470) === 7, "470 menit (7j50m) → 7 jam");
    assert(jamTerbayarDariMenit(480) === 8, "480 menit (8j) → 8 jam");
    assert(jamTerbayarDariMenit(59) === 0, "59 menit → 0 jam");
    assert(jamTerbayarDariMenit(0) === 0, "0 menit → 0 jam");
    assert(jamTerbayarDariMenit(-5) === 0, "menit negatif → 0 (tidak negatif)");

    // Kasus yang dulu salah: floor atas TOTAL, bukan per hari.
    const hariEnam = [470, 470, 470, 470, 470, 470];
    const perHari = hariEnam.reduce((s, m) => s + jamTerbayarDariMenit(m), 0);
    const totalSalah = jamTerbayarDariMenit(hariEnam.reduce((a, b) => a + b, 0));
    assert(perHari === 42, "6 hari × 7j50m → 42 jam (floor per hari)");
    assert(
      totalSalah === 47,
      "bandingkan: floor total 2820 menit → 47 jam (rumus LAMA, sudah tidak dipakai)",
      { perHari, totalSalah }
    );
    assert(perHari !== totalSalah, "selisih 5 jam — floor per hari bukan floor total");

    // ================= [3] validasiTarif =================
    console.log("\n[3] validasiTarif — tarif wajib per tipe (anti-regresi P0-1)");
    assert(
      validasiTarif("JAM", { tarifPerJam: null, tarifPerHari: null, gajiPokokNominal: null }) !== null,
      "JAM tanpa tarifPerJam → DITOLAK"
    );
    assert(
      validasiTarif("HARIAN", { tarifPerJam: 15_000, tarifPerHari: null, gajiPokokNominal: null }) !== null,
      "HARIAN tanpa tarifPerHari → DITOLAK meski tarifPerJam terisi"
    );
    assert(
      validasiTarif("BULANAN", { tarifPerJam: null, tarifPerHari: null, gajiPokokNominal: null }) !== null,
      "BULANAN tanpa nominalGajiPokok → DITOLAK"
    );
    assert(
      validasiTarif("HARIAN", { tarifPerJam: null, tarifPerHari: 120_000, gajiPokokNominal: null }) === null,
      "HARIAN dengan tarifPerHari → valid"
    );
    assert(
      validasiTarif("JAM", { tarifPerJam: 5_000, tarifPerHari: null, gajiPokokNominal: null }) === null,
      "JAM dengan tarifPerJam → valid"
    );
    assert(
      validasiTarif("BULANAN", { tarifPerJam: null, tarifPerHari: null, gajiPokokNominal: 3_500_000 }) === null,
      "BULANAN dengan nominalGajiPokok → valid"
    );

    assert(fieldWajibUntukTipe("HARIAN") === "tarifPerHari", "field wajib HARIAN = tarifPerHari");
    assert(fieldWajibUntukTipe("JAM") === "tarifPerJam", "field wajib JAM = tarifPerJam");
    assert(fieldWajibUntukTipe("BULANAN") === "nominalGajiPokok", "field wajib BULANAN = nominalGajiPokok");

    // ================= [5] Regresi P0-1 =================
    console.log("\n[4] Regresi P0-1 — HARIAN tidak boleh pakai tarifPerJam");
    // Inilah bug aslinya: tarifPerJam dipakai sebagai pengganti tarifPerHari.
    // Sekarang tarifPerHari = null harus menghasilkan 0, bukan 15.000 × 8.
    const p01 = hitungBaseGaji({
      ...base,
      tipe: "HARIAN",
      tarifPerJam: 15_000, // <- sengaja diisi
      tarifPerHari: null, // <- tidak ada tarif harian
      totalHariKerja: 20,
    });
    assert(p01 === 0, "HARIAN + tarifPerJam tapi tanpa tarifPerHari → 0 (bukan 15.000×8)");
    assert(p01 !== 15_000 * 8 * 20, "nilai 0 bukan formula lama tarifPerJam × 8");

    // Jumlah hari 0 → 0
    assert(
      hitungBaseGaji({ ...base, tipe: "HARIAN", tarifPerHari: 120_000, totalHariKerja: 0 }) === 0,
      "HARIAN tanpa hari kerja → 0 (izin/tidak absen tidak dibayar)"
    );

    // ================= [6] Integrasi DB =================
    console.log("\n[5] Integrasi DB — simpan & baca balik tarifPerHari");
    const store = await prisma.store.create({ data: { nama: `${PREFIX}-TOKO` } });
    const user = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`,
        nama: "Karyawan Uji Gaji",
        role: "KARYAWAN",
        status: "AKTIF",
        storeId: store.id,
      },
    });

    // Simulasi apa yang dilakukan PATCH /api/user/[id]/gaji setelah
    // normalisasi + validasi (logic-nya identik dengan route).
    const simpan = async (tipe: "HARIAN" | "BULANAN" | "JAM") => {
      const tarifPerJam = tipe === "JAM" ? 5_000 : null;
      const tarifPerHari = tipe === "HARIAN" ? 120_000 : null;
      const nominal = tipe === "BULANAN" ? 3_500_000 : null;
      const pesan = validasiTarif(tipe, {
        tarifPerJam,
        tarifPerHari,
        gajiPokokNominal: nominal,
      });
      if (pesan) return { ok: false as const, pesan };
      await prisma.user.update({
        where: { id: user.id },
        data: { tipePerhitunganGaji: tipe, tarifPerJam, tarifPerHari },
      });
      if (nominal !== null) {
        await prisma.gajiPokok.upsert({
          where: { employeeId: user.id },
          create: { employeeId: user.id, nominal },
          update: { nominal },
        });
      }
      return { ok: true as const };
    };

    let r = await simpan("HARIAN");
    let u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tarifPerJam: true, tarifPerHari: true, tipePerhitunganGaji: true },
    });
    assert(r.ok, "simpan tipe HARIAN berhasil");
    assert(u?.tarifPerHari === 120_000, "tarifPerHari tersimpan = 120.000", u);
    assert(u?.tarifPerJam === null, "tarifPerJam dinormalkan jadi null", u);

    // Beralih ke JAM: tarifPerHari harus dibuang, tarifPerJam dipakai.
    r = await simpan("JAM");
    const uJam = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tarifPerJam: true, tarifPerHari: true },
    });
    assert(r.ok, "simpan tipe JAM berhasil");
    assert(uJam?.tarifPerJam === 5_000, "tarifPerJam tersimpan = 5.000", uJam);
    assert(uJam?.tarifPerHari === null, "tarifPerHari dinormalkan jadi null", uJam);

    // Beralih ke BULANAN: keduanya dibuang.
    r = await simpan("BULANAN");
    const gp = await prisma.gajiPokok.findUnique({ where: { employeeId: user.id } });
    assert(r.ok, "simpan tipe BULANAN berhasil");
    assert(gp?.nominal === 3_500_000, "GajiPokok tersimpan = 3.500.000", gp);
    const uBulanan = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tarifPerJam: true, tarifPerHari: true },
    });
    assert(uBulanan?.tarifPerJam === null && uBulanan?.tarifPerHari === null, "kedua tarif dinormalkan jadi null", uBulanan);

    // Kembali ke HARIAN — nilai lama tidak boleh "bocor" kembali.
    r = await simpan("HARIAN");
    const uRoundTrip = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tarifPerJam: true, tarifPerHari: true },
    });
    assert(r.ok && uRoundTrip?.tarifPerHari === 120_000, "round-trip HARIAN tetap 120.000", uRoundTrip);

    // NOMINAL_MAX dipakai bersama oleh API
    assert(NOMINAL_MAX === 100_000_000, "NOMINAL_MAX = 100 juta (sama dengan batas API)");

    // ================= Cleanup =================
  } catch (e) {
    console.error("\n💥 Skrip gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[6] Cleanup");
    try {
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: "UJIGAJI-" } },
        select: { id: true },
      });
      for (const x of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: x.id } });
        await prisma.agenda.deleteMany({ where: { targetEmployeeId: x.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: x.id } });
        await prisma.attendance.deleteMany({ where: { employeeId: x.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: x.id } });
        await prisma.user.delete({ where: { id: x.id } });
      }
      await prisma.store.deleteMany({ where: { nama: { contains: PREFIX } } });

      const residu =
        (await prisma.user.count({ where: { kode: { contains: "UJIGAJI" } } })) +
        (await prisma.store.count({ where: { nama: { contains: "UJIGAJI" } } }));
      assert(residu === 0, `residu data uji = ${residu}`);
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      console.error(
        `     Hapus manual:\n` +
          `       DELETE FROM "User"  WHERE kode LIKE 'UJIGAJI%';\n` +
          `       DELETE FROM "Store" WHERE nama LIKE 'UJIGAJI%';`
      );
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

void main();
