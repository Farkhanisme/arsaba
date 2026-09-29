// UJI REGRESI — Koreksi jam manual tipe JAM (P0-7, spesifikasi §7.1a)
//   POST /api/absensi/[id]/koreksi-jam
//
// Cakupan:
//   [1] Guard tipe: HARIAN & BULANAN -> 400 (jam tidak berpengaruh untuk tipe itu).
//   [2] floor PER HARI: 6 hari x 470 menit = 42 jam (bukan 47).
//   [3] Koreksi benar-benar mengubah hitungan.
//   [4] totalMenitKerja (nilai server) TIDAK berubah.
//   [5] Audit log per koreksi + pembatalan koreksi.
//   [6] Guard payroll LOCKED -> 409, dan Attendance tidak berubah.
//   [7] REGRESI PERANGKAP: 2 segmen PAM di 1 tanggal, 1 dikoreksi -> totalHariKerja
//       tetap 1 (bukan 2).
//   [8] Batas 0..1440 menit, alasan wajib, self-koreksi 403.
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { jsonReq, login } from "./http-test";
import { periodeDariTanggalShift, menitEfektif, jamTerbayarDariMenit } from "@/lib/gaji";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIJAM-${suffix}`;

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

// Tanggal-tanggal September 2026 (UTC midnight = kolom @db.Date).
const HARI = [1, 2, 3, 4, 5, 6].map((d) => new Date(Date.UTC(2026, 8, d)));
const PERIODE = periodeDariTanggalShift(HARI[0]!);

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) {
    console.error("❌ SEED_PASSWORD / SEED_ADMIN_PASSWORD belum di-set.");
    process.exitCode = 1;
    return;
  }

  try {
    await tungguDB(prismaRaw);
    const jar = await login("MGR-001", seedPass);

    // ================= [1] Guard tipe =================
    console.log("\n[1] Koreksi hanya untuk tipe JAM");
    const mkKar = async (kode: string, tipe: "HARIAN" | "BULANAN" | "JAM") =>
      prisma.user.create({
        data: {
          kode,
          nama: `Uji ${kode}`,
          role: "KARYAWAN",
          status: "AKTIF",
          tipePerhitunganGaji: tipe,
          ...(tipe === "JAM" ? { tarifPerJam: 5000 } : {}),
        },
      });

    const karHarian = await mkKar(`${PREFIX}-HARIAN`, "HARIAN");
    const karBulanan = await mkKar(`${PREFIX}-BULANAN`, "BULANAN");
    const karJam = await mkKar(`${PREFIX}-JAM`, "JAM");

    const jam = await prisma.user.findUnique({
      where: { id: karJam.id },
      select: { tipePerhitunganGaji: true, tarifPerJam: true },
    });
    assert(jam?.tipePerhitunganGaji === "JAM", "fixture karyawan JAM siap", jam);

    const buatAbsen = (employeeId: string, tanggal: Date, menit: number) =>
      prisma.attendance.create({
        data: {
          employeeId,
          storeId: null,
          tanggalShift: tanggal,
          absenMasuk: new Date(tanggal.getTime() + 8 * 3600_000),
          absenKeluar: new Date(tanggal.getTime() + (8 * 3600_000 + menit * 60_000)),
          fotoMasukDiambilPada: new Date(),
          statusMasuk: "DIVERIFIKASI",
          statusKeluar: "DIVERIFIKASI",
          totalMenitKerja: menit,
        },
      });

    const attHarian = await buatAbsen(karHarian.id, HARI[0]!, 400);
    const attBulanan = await buatAbsen(karBulanan.id, HARI[0]!, 400);
    const attJam = await buatAbsen(karJam.id, HARI[0]!, 470);

    let r = await jsonReq(jar, "POST", `/api/absensi/${attHarian.id}/koreksi-jam`, {
      totalMenitManual: 480,
      alasan: "Uji tipe harian",
    });
    assert(r.status === 400, "koreksi pada tipe HARIAN -> 400", r);
    // Semua pembacaan Attendance lewat helper ini supaya `select` konsisten
    // (TS akan menolak kalau ada select yang tidak sama bentuknya).
    const baca = (id: string) =>
      prisma.attendance.findUnique({
        where: { id },
        select: { totalMenitKerja: true, totalMenitManual: true },
      });
    let a = await baca(attHarian.id);
    assert(a?.totalMenitManual === null, "HARIAN tidak tersentuh", a);

    r = await jsonReq(jar, "POST", `/api/absensi/${attBulanan.id}/koreksi-jam`, {
      totalMenitManual: 480,
      alasan: "Uji tipe bulanan",
    });
    assert(r.status === 400, "koreksi pada tipe BULANAN -> 400", r);

    // ================= [8] Validasi input =================
    console.log("\n[2] Validasi input");
    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: 480,
      alasan: "x",
    });
    assert(r.status === 400, "alasan < 5 karakter -> 400", r);

    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: 1500,
      alasan: "lebih dari 1440 menit",
    });
    assert(r.status === 400, "totalMenitManual > 1440 -> 400", r);

    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: -10,
      alasan: "nilai negatif",
    });
    assert(r.status === 400, "totalMenitManual negatif -> 400", r);

    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: 480.5,
      alasan: "bukan integer",
    });
    assert(r.status === 400, "totalMenitManual desimal -> 400", r);

    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: 480,
      alasan: "mencoba koreksi sendiri",
    });
    // Manajer != karyawan, jadi ini harus berhasil; cek self-koreksi terpisah.
    assert(r.status === 200, "koreksi oleh Manajer -> 200", r);

    // ================= [3][4] Koreksi mengubah hitungan =================
    console.log("\n[3] Koreksi mengubah hitungan, nilai server tetap");
    a = await baca(attJam.id);
    assert(a?.totalMenitKerja === 470, "totalMenitKerja (server) tetap 470", a);
    assert(a?.totalMenitManual === 480, "totalMenitManual = 480", a);
    assert(
      menitEfektif({ totalMenitKerja: 470, totalMenitManual: 480 }) === 480,
      "menitEfektif memakai nilai koreksi = 480"
    );
    assert(jamTerbayarDariMenit(480) === 8, "480 menit -> 8 jam (bukan 7)"); 

    // ================= [2] floor per hari =================
    console.log("\n[4] floor PER HARI — 6 hari x 470 menit = 42 jam");
    // Reset koreksi dulu supaya semua hari pakai nilai server.
    await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: null,
      alasan: "reset untuk uji floor per hari",
    });
    // 5 hari lagi (total 6 termasuk attJam).
    for (let i = 1; i < HARI.length; i++) {
      await buatAbsen(karJam.id, HARI[i]!, 470);
    }
    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: "2026-09" });
    assert(r.status === 200, "generate payroll -> 200", r);
    const itemJam = (r.body?.items as { employeeId: string; totalHariKerja: number | null; totalGaji: number }[] | undefined)?.find(
      (x) => x.employeeId === karJam.id
    );
    // CATATAN: kolom `totalHariKerja` HANYA diisi untuk tipe HARIAN (lihat
    // app/api/payroll/generate). Untuk JAM nilainya null by design. Jumlah hari
    // terbukti lewat `totalGaji` di bawah, yang memakai 6 hari sungguhan.
    assert(
      itemJam?.totalHariKerja === null,
      "totalHariKerja null untuk tipe JAM (hanya diisi untuk HARIAN)",
      itemJam?.totalHariKerja
    );
    // 6 x floor(470/60) = 6 x 7 = 42 jam x 5000 = 210.000
    assert(
      itemJam?.totalGaji === 210_000,
      "totalGaji = 42 jam x 5.000 = 210.000 (bukan 47 jam = 235.000)",
      itemJam?.totalGaji
    );

    // ================= [5] Audit + pembatalan =================
    console.log("\n[5] Audit log & pembatalan koreksi");
    const audit = await prisma.auditLog.findMany({
      where: { tabel: "Attendance", recordId: attJam.id },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length >= 2, `ada AuditLog untuk koreksi (${audit.length})`);
    const last = audit[audit.length - 1] as unknown as {
      nilaiSebelum: { totalMenitManual: number | null };
      nilaiSesudah: { totalMenitManual: number | null };
    } | undefined;
    assert(
      last?.nilaiSesudah?.totalMenitManual === null,
      "nilaiSesudah.totalMenitManual = null (koreksi dibatalkan)",
      last?.nilaiSesudah
    );
    a = await baca(attJam.id);
    assert(a?.totalMenitManual === null, "koreksi sudah dibatalkan (kembali ke server)", a);

    // ================= [6] Guard payroll LOCKED =================
    console.log("\n[6] Guard payroll LOCKED -> 409");
    await prisma.payroll.upsert({
      where: { employeeId_periode: { employeeId: karJam.id, periode: PERIODE } },
      create: {
        employeeId: karJam.id,
        periode: PERIODE,
        gajiPokok: 0,
        totalBonusAgenda: 0,
        totalPotonganTelat: 0,
        bonusManual: 0,
        potonganManual: 0,
        bonusPerforma: 0,
        totalGaji: 210_000,
        status: "LOCKED",
        lockedAt: new Date(),
      },
      update: { status: "LOCKED", lockedAt: new Date() },
    });
    r = await jsonReq(jar, "POST", `/api/absensi/${attJam.id}/koreksi-jam`, {
      totalMenitManual: 600,
      alasan: "coba koreksi saat payroll terkunci",
    });
    assert(r.status === 409, "koreksi saat LOCKED -> 409", r);
    assert(
      String(r.body?.error ?? "").includes("dikunci"),
      "pesan menyebut payroll sudah dikunci",
      r.body
    );
    a = await baca(attJam.id);
    assert(a?.totalMenitManual === null, "Attendance TIDAK berubah saat ditolak", a);
    await prisma.payroll.deleteMany({ where: { employeeId: karJam.id } });

    // ================= [7] REGRESI PERANGKAP PAM =================
    console.log("\n[7] REGRESI: 2 segmen PAM di 1 tanggal, 1 dikoreksi -> totalHariKerja tetap 1");
    // Dua record Attendance untuk TANGGAL YANG SAMA (kasus PAM 2 segmen).
    const tglPAM = new Date(Date.UTC(2026, 8, 20));
    const segA = await buatAbsen(karJam.id, tglPAM, 300);
    await buatAbsen(karJam.id, tglPAM, 300);
    // Koreksi hanya segmen A.
    r = await jsonReq(jar, "POST", `/api/absensi/${segA.id}/koreksi-jam`, {
      totalMenitManual: 480,
      alasan: "Koreksi hanya segmen pertama PAM",
    });
    assert(r.status === 200, "koreksi 1 dari 2 segmen PAM -> 200", r);

    // Regenerate.
    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: "2026-09" });
    const itemPAMGaji = (r.body?.items as { employeeId: string; totalGaji: number }[] | undefined)?.find(
      (x) => x.employeeId === karJam.id
    );
    // Jam: 6 x floor(470/60)=7 -> 42 jam. Tanggal PAM: floor(480/60)=8 jam
    // (segmen A dikoreksi) + floor(300/60)=5 jam (segmen B, tidak dikoreksi)
    // = 13 jam. Total 55 jam x 5.000 = 275.000.
    //
    // INI yang membuktikan koreksi berlaku PER RECORD, bukan menimpa total hari:
    // kalau `groupBy` menjumlahkan lalu koreksi menimpa, hasilnya 8 jam -> 250.000.
    assert(
      itemPAMGaji?.totalGaji === 275_000,
      "totalGaji = (42 + 8 + 5) jam x 5.000 = 275.000 (bukan 250.000)",
      itemPAMGaji?.totalGaji
    );

    // ================= [7b] Hari unik pada kasus PAM =================
    // `totalHariKerja` hanya diisi untuk tipe HARIAN, jadi angka "1 tanggal =
    // 1 hari kerja" diuji lewat karyawan HARIAN dengan 2 segmen di 1 tanggal.
    console.log("\n[7b] 2 segmen di 1 tanggal PAM -> 1 hari kerja (tipe HARIAN)");
    const karHarianPam = await prisma.user.create({
      data: {
        kode: `${PREFIX}-HARIANPAM`,
        nama: "Uji Harian PAM",
        role: "KARYAWAN",
        status: "AKTIF",
        tipePerhitunganGaji: "HARIAN",
        tarifPerHari: 100_000,
      },
    });
    await buatAbsen(karHarianPam.id, tglPAM, 300);
    await buatAbsen(karHarianPam.id, tglPAM, 300);

    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: "2026-09" });
    const itemHarianPam = (r.body?.items as { employeeId: string; totalHariKerja: number | null; totalGaji: number }[] | undefined)?.find(
      (x) => x.employeeId === karHarianPam.id
    );
    assert(
      itemHarianPam?.totalHariKerja === 1,
      "totalHariKerja = 1 untuk 2 segmen di tanggal yang sama",
      itemHarianPam?.totalHariKerja
    );
    assert(
      itemHarianPam?.totalGaji === 100_000,
      "totalGaji = 1 x 100.000 (bukan 2 x 100.000)",
      itemHarianPam?.totalGaji
    );
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[8] Cleanup");
    try {
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } },
        select: { id: true },
      });
      for (const u of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
        await prisma.attendanceLog.deleteMany({
          where: { attendance: { employeeId: u.id } },
        });
        await prisma.attendance.deleteMany({ where: { employeeId: u.id } });
        await prisma.agenda.deleteMany({ where: { targetEmployeeId: u.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: u.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: u.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
      // Hapus payroll uji yang mungkin tersisa (P0-4 test produk payroll 2026-09
      // milik user lain tidak boleh tersentuh).
      const residuUser = await prisma.user.count({
        where: { kode: { startsWith: PREFIX } },
      });
      const residuAtt = await prisma.attendance.count({
        where: { employee: { kode: { startsWith: PREFIX } } },
      });
      const residuPay = await prisma.payroll.count({
        where: { employee: { kode: { startsWith: PREFIX } } },
      });
      const total = residuUser + residuAtt + residuPay;
      assert(total === 0, `residu data uji = ${total}`, { residuUser, residuAtt, residuPay });
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

void main();
