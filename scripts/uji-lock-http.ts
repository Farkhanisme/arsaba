// UJI REGRESI — Blocker payroll: antrean verifikasi absensi yang belum tuntas
//   PATCH /api/payroll/[id]/lock
//
// MASALAH YANG DIPUTUSKAN
//   `payroll/generate` hanya menghitung `statusMasuk: "DIVERIFIKASI"`. Absensi
//   yang masih `PENDING_VERIFIKASI` berarti hari itu TIDAK masuk gaji. Tanpa
//   guard, Manajer bisa mengunci payslip yang diam-diam kehilangan hari kerja —
//   kelas bug yang sama dengan "bonus agenda hilang senyap" (P0-4), tapi untuk
//   absensi. Route lock sekarang menolak dengan 409 sampai antrean bersih.
//
// Cakupan:
//   [1] Lock ditolak 409 saat ada statusMasuk = PENDING di periode itu.
//   [2] REGRESI PERANGKAP: lock TIDAK ditolak saat hanya statusKeluar yang
//       PENDING. Perhitungan gaji tidak memfilter statusKeluar sama sekali,
//       jadi record seperti itu sudah terbayar. Kalau ikut memblokir, payslip
//       terkunci tanpa jalan keluar.
//   [3] Lock TIDAK ditolak untuk pending di periode LAIN.
//   [4] Setelah pending diselesaikan (verifikasi ATAU ditolak), lock jalan.
//       Penolakan harus melepas diri dari blokir — itu keputusan sadar.
//   [5] Generate melaporkan `belumTerverifikasi` supaya ketahuan lebih awal.
//   [6] Angka gaji tidak berubah oleh guard ini (tidak ada yang dibayar lebih).
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { jsonReq, login } from "./http-test";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJILOCK-${suffix}`;
const PERIODE = "2026-09";

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

const tgl = (d: number) => new Date(Date.UTC(2026, 8, d));

type Absen = {
  employeeId: string;
  storeId: null;
  tanggalShift: Date;
  absenMasuk: Date;
  fotoMasukDiambilPada: Date;
  statusMasuk: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK";
  statusKeluar: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK";
  totalMenitKerja: number;
};

const buatAbsen = (employeeId: string, tanggal: Date, over: Partial<Absen> = {}) =>
  prisma.attendance.create({
    data: {
      employeeId,
      storeId: null,
      tanggalShift: tanggal,
      absenMasuk: new Date(tanggal.getTime() + 8 * 3600_000),
      fotoMasukDiambilPada: new Date(),
      statusMasuk: "PENDING_VERIFIKASI",
      statusKeluar: "PENDING_VERIFIKASI",
      totalMenitKerja: 480,
      ...over,
    } as Absen,
  });

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

    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`,
        nama: "Karyawan Uji Lock",
        role: "KARYAWAN",
        status: "AKTIF",
        tipePerhitunganGaji: "HARIAN",
        tarifPerHari: 100_000,
      },
    });

    // Generate dulu supaya payroll DRAFT-nya ada.
    let r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: PERIODE });
    assert(r.status === 200, "generate awal -> 200", r.status);

    const payroll = await prisma.payroll.findUnique({
      where: {
        employeeId_periode: {
          employeeId: kar.id,
          periode: new Date(Date.UTC(2026, 8, 1)),
        },
      },
      select: { id: true, status: true },
    });
    assert(payroll !== null, "payroll DRAFT dibuat", payroll);
    const payrollId = payroll!.id;

    // ============================================================
    // [1] Pending statusMasuk memblokir lock
    // ============================================================
    console.log("\n[1] statusMasuk PENDING -> lock ditolak 409");
    const pending1 = await buatAbsen(kar.id, tgl(5), {
      statusMasuk: "PENDING_VERIFIKASI",
      statusKeluar: "PENDING_VERIFIKASI",
    });
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    assert(r.status === 409, "lock ditolak 409", r);
    assert(
      r.body?.belumTerverifikasi === 1,
      "respons menyebut jumlah absensi tertunda = 1",
      r.body
    );
    assert(
      ((r.body?.tanggal as string[] | undefined) ?? []).includes("2026-09-05"),
      "respons menyebut tanggalnya",
      r.body
    );
    assert(
      r.body?.href === "/verifikasi/absensi",
      "respons memberi link antrean verifikasi",
      r.body
    );
    let st = await prisma.payroll.findUnique({
      where: { id: payrollId },
      select: { status: true },
    });
    assert(st?.status === "DRAFT", "payroll tetap DRAFT (tidak terkunci)", st?.status);

    // ============================================================
    // [2] REGRESI PERANGKAP — hanya statusKeluar pending
    // ============================================================
    console.log("\n[2] REGRESI: hanya statusKeluar PENDING -> TIDAK boleh memblokir");
    // Selesaikan pending1 supaya tidak ada statusMasuk pending.
    await prisma.attendance.update({
      where: { id: pending1.id },
      data: { statusMasuk: "DIVERIFIKASI" },
    });
    // Record ini: masuk terverifikasi (dibayar), keluar masih pending.
    // Perhitungan gaji tidak memfilter statusKeluar -> sudah terbayar.
    const hanyaKeluar = await buatAbsen(kar.id, tgl(6), {
      statusMasuk: "DIVERIFIKASI",
      statusKeluar: "PENDING_VERIFIKASI",
    });
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    assert(r.status === 200, "lock BERHASIL (tidak terblokir)", r);
    st = await prisma.payroll.findUnique({
      where: { id: payrollId },
      select: { status: true },
    });
    assert(st?.status === "LOCKED", "payroll jadi LOCKED", st?.status);
    console.log(
      `  ℹ️  hanyaKeluar.id=${hanyaKeluar.id} statusKeluar=${hanyaKeluar.statusKeluar}`
    );

    // ============================================================
    // [3] Pending di periode lain tidakRelevan
    // ============================================================
    console.log("\n[3] PENDING di periode LAIN -> tidak relevan");
    const october = new Date(Date.UTC(2026, 9, 7));
    await buatAbsen(kar.id, october, { statusMasuk: "PENDING_VERIFIKASI" });
    // Kembalikan ke DRAFT supaya bisa di-lock ulang di bulan September.
    await prisma.payroll.update({
      where: { id: payrollId },
      data: { status: "DRAFT", lockedAt: null, lockedById: null },
    });
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    assert(
      r.status === 200,
      "lock September jalan walau Oktober masih pending",
      r
    );

    // ============================================================
    // [4] DITOLAK melepas dari blokir
    // ============================================================
    console.log("\n[4] statusMasuk DITOLAK harus melepas dari blokir");
    await prisma.payroll.update({
      where: { id: payrollId },
      data: { status: "DRAFT", lockedAt: null, lockedById: null },
    });
    const pending2 = await buatAbsen(kar.id, tgl(8), {
      statusMasuk: "PENDING_VERIFIKASI",
    });
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    assert(r.status === 409, "masih terblokir selama pending2 ada", r.status);

    await prisma.attendance.update({
      where: { id: pending2.id },
      data: { statusMasuk: "DITOLAK" },
    });
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    assert(
      r.status === 200,
      "setelah DITOLAK, lock jalan (penolakan = sudah diselesaikan)",
      r
    );

    // ============================================================
    // [5] Generate melaporkan belumTerverifikasi
    // ============================================================
    console.log("\n[5] Generate melaporkan belumTerverifikasi");
    await buatAbsen(kar.id, tgl(9), { statusMasuk: "PENDING_VERIFIKASI" });
    await buatAbsen(kar.id, tgl(10), { statusMasuk: "PENDING_VERIFIKASI" });
    // Buka lagi supaya generate re-sync DRAFT.
    await prisma.payroll.update({
      where: { id: payrollId },
      data: { status: "DRAFT", lockedAt: null, lockedById: null },
    });
    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: PERIODE });
    const belum = (
      r.body?.belumTerverifikasi as
        | { employeeId: string; jumlah: number; tanggal: string[] }[]
        | undefined
    )?.find((x) => x.employeeId === kar.id);
    assert(!!belum, "generate melaporkan karyawan dengan pending", belum);
    assert(belum?.jumlah === 2, "jumlah pending = 2", belum?.jumlah);
    assert(
      (belum?.tanggal ?? []).join(",") === "2026-09-09,2026-09-10",
      "tanggal pending benar & terurut",
      belum?.tanggal
    );

    // ============================================================
    // [6] Guard tidak mengubah angka gaji
    // ============================================================
    console.log("\n[6] Guard lock tidak mengubah angka gaji");
    const sebelum = await prisma.payroll.findUnique({
      where: { id: payrollId },
      select: { totalGaji: true, totalHariKerja: true },
    });
    await jsonReq(jar, "PATCH", `/api/payroll/${payrollId}/lock`, {});
    const sesudah = await prisma.payroll.findUnique({
      where: { id: payrollId },
      select: { totalGaji: true, totalHariKerja: true },
    });
    assert(
      sebelum?.totalGaji === sesudah?.totalGaji,
      "totalGaji tidak berubah oleh guard",
      { sebelum: sebelum?.totalGaji, sesudah: sesudah?.totalGaji }
    );
    assert(
      sebelum?.totalHariKerja === sesudah?.totalHariKerja,
      "totalHariKerja tidak berubah oleh guard",
      { sebelum: sebelum?.totalHariKerja, sesudah: sesudah?.totalHariKerja }
    );
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[7] Cleanup");
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
      assert(total === 0, `residu data uji = ${total}`, {
        residuUser,
        residuAtt,
        residuPay,
      });
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
