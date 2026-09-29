// UJI REGRESI — Mengamankan `override-keluar` (P0-3)
//   PATCH /api/absensi/[id]/override-keluar
//
// MASALAH YANG DIPUTUSKAN
//   Route ini menulis `totalMenitKerja` LANGSUNG (bukan lewat `totalMenitManual`
//   seperti `koreksi-jam`), dan hanya memvalidasi `absenKeluar` hanya "bisa di-parse".
//   Akibatnya:
//     - `absenKeluar` tahun 2099 diterima -> `totalMenitKerja` ratusan ribu menit
//       -> langsung masuk gaji tipe `JAM`.
//     - `absenKeluar < absenMasuk` TIDAK error: `hitungTotalMenitKerja` memakai
//       `Math.max(0, …)` jadi 0 menit, route balas 200, payslip menampilkan "0"
//       seolah itu hasil benar.
//     - Tidak ada `payrollLocked`, jadi bisa menabrak payslip yang sudah final —
//       dan `PATCH /api/payroll/[id]` menolak saat LOCKED, jadi tidak ada cara
//       memperbaikinya.
//     - Tidak ada `AuditLog` untuk outcome verifikasi + perubahan angka gaji.
//     - Tidak ada `$transaction`.
//
// Cakupan:
//   [1] Batas waktu: lebih awal dari masuk, masa depan, > 24 jam -> 400, dan
//       TIDAK ada yang tertulis.
//   [2] Tepat 24 jam TIDAK ditolak (kasus sah untuk toko buka 24 jam).
//   [3] Guard payroll LOCKED -> 409 dan `totalMenitKerja` tidak berubah.
//   [4] Sukses -> `AuditLog` dengan `nilaiSebelum` (termasuk `absenKeluar` lama).
//   [5] REGRESI DESAIN: `totalMenitManual` TIDAK boleh tersentuh di sini.
//   [6] Guard yang sudah ada tidak boleh regresi: self 403, sudah ada keluar 409.
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { jsonReq, login } from "./http-test";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIOTKELUAR-${suffix}`;
const PERIODE = "2026-09";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.error(`  ❌ ${label}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`); }
}

/**
 * Tanggal Sept 2026 — WAJIB bulan berjalan dan sebelum hari ini.
 *
 * Route menolak `absenKeluar` yang "di masa depan". Kalau test memakai tanggal
 * bulan berikutnya, SEMUA assert gagal dengan pesan "masa depan" dan kelihatan
 * seperti route-nya salah. Seed memakai 2026-09, jadi pakai bulan yang sama.
 */
const BULAN = 8; // 0-based: 8 = September
const tgl = (d: number) => new Date(Date.UTC(2026, BULAN, d));
const MENIT = 60_000;

/**
 * Semua pembacaan Attendance lewat helper ini supaya bentuk `select` seragam.
 *
 * Kalau tiap blok挑选 `select` sendiri, TypeScript akan menolak nilai yang
 * dikembalikan karena tipenya berbeda-beda — bukan karena ada yang salah.
 */
const baca = (id: string) =>
  prisma.attendance.findUnique({
    where: { id },
    select: {
      absenKeluar: true,
      totalMenitKerja: true,
      totalMenitManual: true,
      koreksiJamAlasan: true,
    },
  });

/** Absensi PENDING, belum ada absenKeluar, dengan jam masuk di tengah malam UTC hari itu. */
const buatAbsen = (employeeId: string, tanggal: Date, jamMasukUtc: number) =>
  prisma.attendance.create({
    data: {
      employeeId, storeId: null, tanggalShift: tanggal,
      absenMasuk: new Date(tanggal.getTime() + jamMasukUtc * MENIT),
      fotoMasukDiambilPada: new Date(),
      statusMasuk: "DIVERIFIKASI",
      statusKeluar: "PENDING_VERIFIKASI",
      totalMenitKerja: 0,
    },
  });

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) { console.error("❌ SEED_PASSWORD belum di-set."); process.exitCode = 1; return; }

  // `payroll/generate` itu GLOBAL — snapshot dulu supaya cleanup tidak
  // menghapus payroll yang bukan milik test ini.
  const periodeDate = new Date(`${PERIODE}-01T00:00:00.000Z`);
  let idPayrollSebelum: Set<string>;
  try {
    await tungguDB(prismaRaw);
    const snap = await prisma.payroll.findMany({ where: { periode: periodeDate }, select: { id: true } });
    idPayrollSebelum = new Set(snap.map((p) => p.id));
  } catch (e) {
    console.error("❌ Gagal snapshot payroll sebelum test. Test dibatalkan.", e);
    await prismaRaw.$disconnect();
    process.exitCode = 1;
    return;
  }

  try {
    const jarMGR = await login("MGR-001", seedPass);

    // Karyawan tipe JAM: dari situ dampaknya ke gaji paling nyata.
    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`, nama: "Uji Override Keluar", role: "KARYAWAN",
        status: "AKTIF", tipePerhitunganGaji: "JAM", tarifPerJam: 10_000,
      },
    });

    // ============================================================
    console.log("\n[1] Batas waktu");
    // Jam masuk 08:00 UTC.
    const a1 = await buatAbsen(kar.id, tgl(5), 8 * 60);

    // 1a. Lebih awal dari masuk (07:00).
    let r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a1.id}/override-keluar`, {
      absenKeluar: new Date(tgl(5).getTime() + 7 * 60 * MENIT).toISOString(),
      keterangan: "sengaja lebih awal",
    });
    assert(r.status === 400, "keluar < masuk -> 400", r);
    assert(
      String(r.body?.error ?? "").includes("tidak boleh lebih awal"),
      "pesan menyebut 'tidak boleh lebih awal dari waktu masuk'",
      r.body
    );
    let row = await baca(a1.id);
    assert(row?.absenKeluar === null && row?.totalMenitKerja === 0, "tidak ada yang tertulis", row);

    // 1b. Masa depan.
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a1.id}/override-keluar`, {
      absenKeluar: new Date(Date.now() + 10 * 60 * MENIT).toISOString(),
      keterangan: "sengaja masa depan",
    });
    assert(r.status === 400, "keluar di masa depan -> 400", r);

    // 1c. Lebih dari 24 jam (masuk 5 Okt 08:00, keluar 7 Okt 08:00 = 48 jam).
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a1.id}/override-keluar`, {
      absenKeluar: new Date(tgl(7).getTime() + 8 * 60 * MENIT).toISOString(),
      keterangan: "selisih 48 jam",
    });
    assert(r.status === 400, "selisih 48 jam -> 400", r);
    assert(
      String(r.body?.error ?? "").includes("24 jam"),
      "pesan menyebut batas 24 jam",
      r.body
    );

    // ============================================================
    console.log("\n[2] Tepat 24 jam TIDAK ditolak (kasus sah toko buka 24 jam)");
    // Masuk 5 Okt 00:00, keluar 6 Okt 00:00 = tepat 1440 menit.
    const a24 = await buatAbsen(kar.id, tgl(8), 0);
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a24.id}/override-keluar`, {
      absenKeluar: new Date(tgl(9).getTime()).toISOString(),
      keterangan: "tepat 24 jam, uji batas",
    });
    // Keluar 6 Okt 00:00 UTC = 07:00 WIB 6 Okt -> masih masa lalu, sah.
    assert(r.status === 200, "tepat 24 jam -> 200 (tidak ditolak)", { status: r.status, err: r.body?.error });
    row = await baca(a24.id);
    assert(row?.totalMenitKerja === 1440, "totalMenitKerja = 1440", row?.totalMenitKerja);

    // ============================================================
    console.log("\n[3] Guard payroll LOCKED -> 409, data tidak berubah");
    // Buat payroll DRAFT lalu kunci, untuk employee + periode ini.
    await prisma.payroll.upsert({
      where: { employeeId_periode: { employeeId: kar.id, periode: periodeDate } },
      create: {
        employeeId: kar.id, periode: periodeDate, gajiPokok: 0, totalBonusAgenda: 0,
        totalPotonganTelat: 0, bonusManual: 0, potonganManual: 0, bonusPerforma: 0,
        totalGaji: 0, status: "LOCKED", lockedAt: new Date(),
      },
      update: { status: "LOCKED", lockedAt: new Date() },
    });
    const a2 = await buatAbsen(kar.id, tgl(12), 8 * 60);
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a2.id}/override-keluar`, {
      absenKeluar: new Date(tgl(12).getTime() + 16 * 60 * MENIT).toISOString(),
      keterangan: "coba override saat payroll terkunci",
    });
    assert(r.status === 409, "override saat LOCKED -> 409", r);
    assert(
      String(r.body?.error ?? "").includes("dikunci"),
      "pesan menyebut payroll sudah dikunci",
      r.body
    );
    row = await baca(a2.id);
    assert(row?.absenKeluar === null && row?.totalMenitKerja === 0, "Attendance TIDAK berubah", row);
    // Buka payroll lagi supaya sisa test bisa jalan.
    await prisma.payroll.update({
      where: { employeeId_periode: { employeeId: kar.id, periode: periodeDate } },
      data: { status: "DRAFT", lockedAt: null, lockedById: null },
    });

    // ============================================================
    console.log("\n[4] Sukses -> AuditLog + [5] totalMenitManual tidak tersentuh");
    const a3 = await buatAbsen(kar.id, tgl(15), 8 * 60);
    // Pasang koreksi manual lebih dulu, untuk membuktikan tidak ditimpa.
    await prisma.attendance.update({
      where: { id: a3.id },
      data: { totalMenitManual: 999, koreksiJamAlasan: "koreksi manual sebelumnya" },
    });
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a3.id}/override-keluar`, {
      absenKeluar: new Date(tgl(15).getTime() + 16 * 60 * MENIT).toISOString(),
      keterangan: "karyawan lupa check-out, dikonfirmasi via telepon",
    });
    assert(r.status === 200, "override valid -> 200", { status: r.status, err: r.body?.error });
    assert(r.body?.statusKeluar === "DIVERIFIKASI", "statusKeluar = DIVERIFIKASI", r.body?.statusKeluar);
    assert(r.body?.totalMenitKerja === 480, "totalMenitKerja = 480 (8 jam)", r.body?.totalMenitKerja);

    row = await baca(a3.id);
    assert(row?.totalMenitKerja === 480, "totalMenitKerja tersimpan 480", row?.totalMenitKerja);
    assert(
      row?.totalMenitManual === 999 && row?.koreksiJamAlasan === "koreksi manual sebelumnya",
      "REGRESI DESAIN: totalMenitManual TIDAK tersentuh override",
      row
    );

    const audit = await prisma.auditLog.findMany({
      where: { tabel: "Attendance", recordId: a3.id },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length === 1, `ada tepat 1 AuditLog (${audit.length})`, audit.length);
    const before = audit[0]?.nilaiSebelum as { absenKeluar: string | null; totalMenitKerja: number } | undefined;
    const after = audit[0]?.nilaiSesudah as { absenKeluar: string; totalMenitKerja: number } | undefined;
    assert(before?.absenKeluar === null, "nilaiSebelum.absenKeluar = null (belum ada)", before);
    assert(before?.totalMenitKerja === 0, "nilaiSebelum.totalMenitKerja = 0", before);
    assert(after?.totalMenitKerja === 480, "nilaiSesudah.totalMenitKerja = 480", after);
    assert(
      String(audit[0]?.alasan ?? "").includes("lupa check-out"),
      "alasan audit memuat keterangan admin",
      audit[0]?.alasan
    );

    // ============================================================
    console.log("\n[6] Guard lama tidak boleh regresi");
    // 6a. Sudah ada absenKeluar.
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a3.id}/override-keluar`, {
      absenKeluar: new Date(tgl(15).getTime() + 18 * 60 * MENIT).toISOString(),
      keterangan: "coba override dua kali",
    });
    assert(r.status === 409, "override record yang sudah punya keluar -> 409", r.status);

    // 6b. Self-override -> 403. Butuh absensi milik user yang sedang login
    //     (MGR-001). Buat absensi dengan employeeId = MGR-001.
    const mgr = await prisma.user.findUnique({ where: { kode: "MGR-001" }, select: { id: true } });
    if (mgr) {
      const a4 = await buatAbsen(mgr.id, tgl(16), 8 * 60);
      r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a4.id}/override-keluar`, {
        absenKeluar: new Date(tgl(16).getTime() + 16 * 60 * MENIT).toISOString(),
        keterangan: "coba override absen sendiri",
      });
      assert(r.status === 403, "self-override -> 403", r.status);
    }

    // 6c. Keterangan terlalu pendek.
    const a5 = await buatAbsen(kar.id, tgl(17), 8 * 60);
    r = await jsonReq(jarMGR, "PATCH", `/api/absensi/${a5.id}/override-keluar`, {
      absenKeluar: new Date(tgl(17).getTime() + 16 * 60 * MENIT).toISOString(),
      keterangan: "x",
    });
    assert(r.status === 400, "keterangan < 3 karakter -> 400", r.status);
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[7] Cleanup");
    try {
      const users = await prisma.user.findMany({ where: { kode: { startsWith: PREFIX } }, select: { id: true } });
      for (const u of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
        await prisma.attendanceLog.deleteMany({ where: { attendance: { employeeId: u.id } } });
        await prisma.attendance.deleteMany({ where: { employeeId: u.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: u.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: u.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
      // Absensi milik MGR-001 yang dibuat test.
      const mgr = await prisma.user.findUnique({ where: { kode: "MGR-001" }, select: { id: true } });
      if (mgr) {
        await prisma.attendanceLog.deleteMany({ where: { attendance: { employeeId: mgr.id, tanggalShift: { gte: tgl(16), lt: tgl(20) } } } });
        await prisma.attendance.deleteMany({ where: { employeeId: mgr.id, tanggalShift: { gte: tgl(16), lt: tgl(20) } } });
      }
      // Payroll sampingan dari `generate` global — hanya yang tidak ada di snapshot.
      const all = await prismaRaw.payroll.findMany({ where: { periode: periodeDate }, select: { id: true } });
      const sisa = all.filter((p) => !idPayrollSebelum.has(p.id));
      for (const p of sisa) {
        await prismaRaw.auditLog.deleteMany({ where: { tabel: "Payroll", recordId: p.id } });
      }
      if (sisa.length > 0) {
        await prismaRaw.payroll.deleteMany({ where: { id: { in: sisa.map((p) => p.id) } } });
        console.log(`  🧹 ${sisa.length} payroll sampingan dibersihkan`);
      }
      const residuUser = await prisma.user.count({ where: { kode: { startsWith: PREFIX } } });
      const residuAtt = await prisma.attendance.count({
        where: { employee: { kode: { startsWith: PREFIX } } },
      });
      const total = residuUser + residuAtt;
      assert(total === 0, `residu data uji = ${total}`, { residuUser, residuAtt });
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
