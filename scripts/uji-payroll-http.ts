// UJI REGRESI — Mekanisme revisi payroll (§7.1b)
//   - POST /api/payroll/[id]/revise  (unlock dengan audit)
//   - POST /api/payroll/generate    (re-sync payroll DRAFT)
//
// Cakupan:
//   [1] Revisi butuh alasan (min 10 karakter) -> 400 tanpa alasan.
//   [2] Revisi hanya untuk status LOCKED -> 409 kalau sudah DRAFT.
//   [3] Setelah revisi: status DRAFT, revisiKe naik, revisiAlasan tersimpan.
//   [4] AuditLog `aksi: "REVISI"` dengan nilai sebelum & sesudah.
//   [5] PATCH biasa tetap 403 saat LOCKED (tidak ada jalur edit langsung).
//   [6] generate ulang pada payroll DRAFT: angka ikut ter-update, tapi field
//       input MANUAL tidak ditimpa.
//   [7] generate ulang pada payroll LOCKED: skipped + laporkan selisih.
//   [8] REGRESI: halaman payslip `/manajer/payroll/[id]` benar-benar merender
//       data payroll. Dulu halaman ini Server Component yang memanggil API-nya
//       sendiri lewat `fetch("/api/payroll/" + id)` — fetch relatif tidak punya
//       base URL di Server Component, jadi request-nya tidak pernah sampai dan
//       halaman SELALU tampil "Payroll tidak ditemukan" tanpa error. Error-nya
//       ditelan `catch {}` sehingga tidak pernah terlihat di log.
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { BASE, jsonReq, login } from "./http-test";
import { periodeDariTanggalShift } from "@/lib/gaji";

/** Nama karyawan fixture — dipakai juga untuk cek halaman payslip merender data. */
const EMP_NAMA = "Karyawan Uji Revisi";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIREVISI-${suffix}`;

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

const TANGGAL = new Date("2026-09-15T00:00:00Z"); // tengah malam UTC = 15 Sep WIB
const PERIODE = periodeDariTanggalShift(TANGGAL);

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) {
    console.error("❌ SEED_PASSWORD / SEED_ADMIN_PASSWORD belum di-set.");
    process.exitCode = 1;
    return;
  }

  let payrollId = "";

  try {
    await tungguDB(prismaRaw);
    const jar = await login("MGR-001", seedPass);

    // Fixture: karyawan BULANAN (punya gaji pokok tetap) + payroll DRAFT.
    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`,
        nama: EMP_NAMA,
        role: "KARYAWAN",
        status: "AKTIF",
        tipePerhitunganGaji: "BULANAN",
      },
    });
    await prisma.gajiPokok.create({
      data: { employeeId: kar.id, nominal: 3_500_000 },
    });

    const payroll = await prisma.payroll.create({
      data: {
        employeeId: kar.id,
        periode: PERIODE,
        gajiPokok: 3_500_000,
        totalHariKerja: null,
        totalBonusAgenda: 0,
        totalPotonganTelat: 0,
        bonusManual: 0,
        potonganManual: 0,
        bonusPerforma: 0,
        totalGaji: 3_500_000,
        status: "DRAFT",
      },
    });
    payrollId = payroll.id;

    // ================= [1] Alasan wajib =================
    console.log("\n[1] Revisi butuh alasan");
    let r = await jsonReq(jar, "POST", `/api/payroll/${payroll.id}/revise`, {});
    assert(r.status === 400, "revisi tanpa alasan -> 400", r);

    r = await jsonReq(jar, "POST", `/api/payroll/${payroll.id}/revise`, {
      alasan: "pendek",
    });
    assert(r.status === 400, "alasan < 10 karakter -> 400", r);

    // ================= [2] Hanya untuk LOCKED =================
    console.log("\n[2] Hanya payroll LOCKED yang bisa direvisi");
    r = await jsonReq(jar, "POST", `/api/payroll/${payroll.id}/revise`, {
      alasan: "Coba revisi payroll yang masih DRAFT",
    });
    assert(r.status === 409, "revisi saat DRAFT -> 409", r);
    let p = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: {
        status: true,
        revisiKe: true,
        revisiAlasan: true,
        lockedAt: true,
        lockedById: true,
      },
    });
    assert(p?.status === "DRAFT" && p?.revisiKe === 0, "tidak ada perubahan", p);

    // ================= [3] Lock dulu =================
    console.log("\n[3] Lock lalu revisi");
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payroll.id}/lock`, {});
    assert(r.status === 200, "lock payroll -> 200", r);

    // ================= [5] PATCH biasa tetap 403 =================
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payroll.id}`, {
      bonusManual: 500_000,
    });
    assert(r.status === 403, "PATCH langsung saat LOCKED -> 403 (tidak ada jalur bypass)", r);

    // ================= [3][4] Revisi dengan benar =================
    r = await jsonReq(jar, "POST", `/api/payroll/${payroll.id}/revise`, {
      alasan: "Bonus agenda September terverifikasi terlambat, perlu masuk.",
    });
    assert(r.status === 200, "revisi dengan alasan -> 200", r);
    assert(r.body?.revisiKe === 1, "revisiKe = 1", r.body);

    p = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: { status: true, lockedAt: true, lockedById: true, revisiKe: true, revisiAlasan: true },
    });
    assert(p?.status === "DRAFT", "status kembali DRAFT", p?.status);
    assert(p?.lockedAt === null && p?.lockedById === null, "lockedAt & lockedById dikosongkan", p);
    assert(p?.revisiKe === 1, "revisiKe = 1", p?.revisiKe);
    assert(
      String(p?.revisiAlasan ?? "").includes("terlambat"),
      "revisiAlasan tersimpan",
      p?.revisiAlasan
    );

    // Audit REVISI
    const audit = await prisma.auditLog.findMany({
      where: { tabel: "Payroll", recordId: payroll.id, aksi: "REVISI" },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length === 1, `1 baris AuditLog REVISI (${audit.length})`);
    const rev = audit[0] as unknown as {
      nilaiSebelum: Record<string, unknown>;
      nilaiSesudah: Record<string, unknown>;
      alasan: string;
    } | undefined;
    assert(rev?.nilaiSebelum?.status === "LOCKED", "nilaiSebelum.status = LOCKED", rev?.nilaiSebelum);
    assert(rev?.nilaiSesudah?.status === "DRAFT", "nilaiSesudah.status = DRAFT", rev?.nilaiSesudah);
    assert(Boolean(rev?.alasan?.includes("terlambat")), "alasan tersimpan di audit");

    // ================= [6] generate re-sync DRAFT =================
    console.log("\n[6] generate ulang pada payroll DRAFT -> updated, field manual aman");
    // Set field manual DULU, lalu generate ulang dan pastikan tidak tertimpa.
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payroll.id}`, {
      bonusManual: 750_000,
      bonusPerforma: 250_000,
      keteranganBonusPerforma: "Evaluasi kios",
    });
    assert(r.status === 200, "set field manual saat DRAFT -> 200", r);

    // Tambahkan agenda terverifikasi yang menambah bonus.
    await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-AGENDA`,
        sumber: "MANDIRI_KARYAWAN",
        status: "DIVERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
        nominal: 500_000,
        nominalSetAt: new Date(),
        diselesaikanPada: TANGGAL,
        verifiedAt: new Date(),
      },
    });

    r = await jsonReq(jar, "POST", "/api/payroll/generate", {
      periode: "2026-09",
    });
    assert(r.status === 200, "generate ulang -> 200", r);
    assert(
      typeof r.body?.totalUpdated === "number" && (r.body?.totalUpdated as number) >= 1,
      "ada payroll ber-status 'updated'",
      r.body?.totalUpdated
    );
    assert(r.body?.totalPerluRevisi === 0, "tidak ada yang perlu revisi (semua DRAFT)", r.body);

    const setelah = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: {
        totalBonusAgenda: true,
        bonusManual: true,
        bonusPerforma: true,
        keteranganBonusPerforma: true,
        totalGaji: true,
      },
    });
    assert(
      setelah?.totalBonusAgenda === 500_000,
      "totalBonusAgenda ikut ter-update = 500.000",
      setelah?.totalBonusAgenda
    );
    assert(
      setelah?.bonusManual === 750_000,
      "bonusManual TIDAK ditimpa oleh generate",
      setelah?.bonusManual
    );
    assert(
      setelah?.bonusPerforma === 250_000,
      "bonusPerforma TIDAK ditimpa oleh generate",
      setelah?.bonusPerforma
    );
    assert(
      setelah?.keteranganBonusPerforma === "Evaluasi kios",
      "keteranganBonusPerforma dipertahankan",
      setelah?.keteranganBonusPerforma
    );
    // 3.500.000 + 500.000 + 750.000 + 250.000 = 5.000.000
    assert(
      setelah?.totalGaji === 5_000_000,
      "totalGaji = 3.500.000 + 500.000 + 750.000 + 250.000",
      setelah?.totalGaji
    );

    // ================= [7] generate saat LOCKED =================
    console.log("\n[7] generate saat LOCKED -> skipped + laporkan selisih");
    await jsonReq(jar, "PATCH", `/api/payroll/${payroll.id}/lock`, {});
    // Tambah agenda lagi supaya angka terkini berbeda dari payslip LOCKED.
    await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-AGENDA-2`,
        sumber: "MANDIRI_KARYAWAN",
        status: "DIVERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
        nominal: 300_000,
        nominalSetAt: new Date(),
        diselesaikanPada: TANGGAL,
        verifiedAt: new Date(),
      },
    });

    const locked = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: { totalGaji: true, totalBonusAgenda: true },
    });

    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: "2026-09" });
    assert(r.status === 200, "generate saat LOCKED -> 200 (tidak error)", r);
    const perlu = r.body?.perluRevisi as
      | { employeeId: string; selisihTotal: number; selisihBonus: number }[]
      | undefined;
    const entry = perlu?.find((x) => x.employeeId === kar.id);
    assert(Boolean(entry), "employee ini dilaporkan sebagai perluRevisi", perlu);
    assert(
      entry?.selisihBonus === 300_000,
      "selisihBonus = 300.000 (agenda baru belum masuk payslip)",
      entry?.selisihBonus
    );
    assert(
      entry?.selisihTotal === 300_000,
      "selisihTotal = 300.000",
      entry?.selisihTotal
    );

    const masihSama = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: { totalGaji: true, totalBonusAgenda: true },
    });
    assert(
      masihSama?.totalGaji === locked?.totalGaji,
      "payslip LOCKED TIDAK berubah (tetap konsisten dengan yang dibayarkan)",
      { sebelum: locked?.totalGaji, sesudah: masihSama?.totalGaji }
    );
    assert(
      masihSama?.totalBonusAgenda === locked?.totalBonusAgenda,
      "totalBonusAgenda LOCKED tidak berubah",
      { sebelum: locked?.totalBonusAgenda, sesudah: masihSama?.totalBonusAgenda }
    );

    // Alur lengkap: revisi -> generate ulang -> kunci lagi
    console.log("\n[8] Alur lengkap: revisi -> generate -> lock");
    r = await jsonReq(jar, "POST", `/api/payroll/${payroll.id}/revise`, {
      alasan: "Mengambil bonus agenda yang terverifikasi setelah lock",
    });
    assert(r.status === 200 && r.body?.revisiKe === 2, "revisi ke-2 -> 200", r.body);
    r = await jsonReq(jar, "POST", "/api/payroll/generate", { periode: "2026-09" });
    assert(r.status === 200, "generate ulang setelah revisi -> 200", r);
    const final = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: { totalBonusAgenda: true, totalGaji: true, status: true, bonusManual: true },
    });
    assert(
      final?.totalBonusAgenda === 800_000,
      "bonus agenda akhirnya 800.000 (500.000 + 300.000)",
      final?.totalBonusAgenda
    );
    assert(
      final?.bonusManual === 750_000,
      "field manual tetap aman setelah re-sync",
      final?.bonusManual
    );
    r = await jsonReq(jar, "PATCH", `/api/payroll/${payroll.id}/lock`, {});
    assert(r.status === 200, "kunci ulang -> 200", r);
    const terkunci = await prisma.payroll.findUnique({
      where: { id: payroll.id },
      select: { status: true, revisiKe: true, revisiAlasan: true },
    });
    assert(terkunci?.status === "LOCKED", "status kembali LOCKED", terkunci?.status);
    assert(terkunci?.revisiKe === 2, "revisiKe tercatat 2", terkunci?.revisiKe);
    assert(
      String(terkunci?.revisiAlasan ?? "").includes("terverifikasi"),
      "revisiAlasan terakhir tersimpan (ditampilkan di payslip)",
      terkunci?.revisiAlasan
    );

    // ================= [8] REGRESI: halaman payslip merender data =================
    console.log("\n[8] Halaman payslip benar-benar merender data payroll");
    const halaman = await fetch(`${BASE}/manajer/payroll/${payroll.id}`, {
      headers: { cookie: jar },
    });
    const html = await halaman.text();
    assert(halaman.status === 200, "halaman payslip -> 200", halaman.status);
    assert(
      !html.includes("Payroll tidak ditemukan"),
      "halaman TIDAK menampilkan 'Payroll tidak ditemukan'",
      html.length
    );
    assert(
      html.includes(EMP_NAMA),
      `halaman memuat nama karyawan uji (${EMP_NAMA})`,
      html.length
    );
    assert(
      html.includes("Total Gaji"),
      "halaman memuat blok 'Total Gaji'",
      html.length
    );
    // Badge revisi harus ikut tampil — kalau tidak, §7.1b tidak ada gunanya.
    assert(
      /[Rr]evisi/.test(html),
      "halaman menampilkan informasi revisi",
      html.length
    );

    // ============================================================
    // [9] REGRESI: DAFTAR payroll benar-benar merender data
    // ============================================================
    // Halaman `/manajer/payroll` (versi daftar) punya bug yang sama seperti
    // payslip detail: Server Component yang memanggil API-nya sendiri lewat
    // `fetch("/api/payroll?...")`. Fetch relatif tidak punya base URL di Server
    // Component, jadi request-nya tidak pernah sampai, `catch {}` menelan
    // errornya, dan halaman SELALU menampilkan "Daftar Payroll (0)".
    //
    // Yang diuji: jumlah baris payslip yang dirender HARUS sama dengan jumlah
    // yang dikembalikan `GET /api/payroll` untuk filter yang sama. Kalau
    // keduanya menyimpang, salah satu dari dua pintu itu salah.
    console.log("\n[9] Halaman daftar payroll merender data");
    const cekDaftar = async (
      label: string,
      qs: string
    ): Promise<{ ok: boolean; baris: number; api: number }> => {
      const halamanDaftar = await fetch(`${BASE}/manajer/payroll${qs}`, {
        headers: { cookie: jar },
      });
      const htmlDaftar = await halamanDaftar.text();
      // Hanya href detail payslip (cuid), bukan link lain di halaman.
      const ids = new Set(
        (htmlDaftar.match(/href="\/manajer\/payroll\/[a-z0-9]{20,}"/g) ?? []).map(
          (m) => m.match(/payroll\/([a-z0-9]+)"/)![1]
        )
      );
      const baris = ids.size;
      const apiJson = (await (
        await fetch(`${BASE}/api/payroll${qs}`, { headers: { cookie: jar } })
      ).json()) as { total?: number };
      const api = apiJson.total ?? -1;
      const kosongState = htmlDaftar.includes("Belum ada payroll");
      const ok =
        halamanDaftar.status === 200 &&
        api >= 0 &&
        baris === api &&
        kosongState === (api === 0);
      console.log(`   ${ok ? "✅" : "❌"} ${label} — baris=${baris} api=${api}`);
      return { ok, baris, api };
    };

    const tanpa = await cekDaftar("(tanpa filter)", "");
    assert(
      tanpa.ok && tanpa.baris > 0,
      `daftar tanpa filter merender ${tanpa.baris} baris (bukan 0)`,
      tanpa
    );

    const draf = await cekDaftar("status=DRAFT", "?periode=2026-09&status=DRAFT");
    assert(draf.ok, "daftar terfilter DRAFT cocok dengan API", draf);

    // Periode tanpa data harus menampilkan empty state, bukan error.
    const kosong = await cekDaftar("periode tanpa data", "?periode=2020-01");
    assert(
      kosong.ok && kosong.baris === 0,
      "periode tanpa data -> 0 baris + empty state",
      kosong
    );

    // Param ngawur harus aman: API menolak dengan 400, tapi halaman tetap
    // merender (param diabaikan, bukan di-query). Kalau halaman ikut error,
    // `space-y-6` + heading akan hilang.
    const ngawur = await fetch(`${BASE}/manajer/payroll?periode=abc&status=nonsense`, {
      headers: { cookie: jar },
    });
    const htmlNgawur = await ngawur.text();
    assert(
      ngawur.status === 200 && htmlNgawur.includes("Kelola Payroll Bulanan"),
      "param ngawur -> halaman tetap 200 dan lengkap",
      ngawur.status
    );
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[9] Cleanup");
    try {
      if (payrollId) {
        await prisma.auditLog.deleteMany({ where: { tabel: "Payroll", recordId: payrollId } });
        await prisma.payroll.deleteMany({ where: { id: payrollId } });
      }
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } },
        select: { id: true },
      });
      for (const x of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: x.id } });
        await prisma.agenda.deleteMany({ where: { targetEmployeeId: x.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: x.id } });
        await prisma.attendance.deleteMany({ where: { employeeId: x.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: x.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: x.id } });
        await prisma.user.delete({ where: { id: x.id } });
      }
      const residu =
        (await prisma.user.count({ where: { kode: { contains: "UJIREVISI" } } })) +
        (await prisma.agenda.count({ where: { judul: { contains: "UJIREVISI" } } })) +
        (await prisma.payroll.count({
          where: { employee: { kode: { contains: "UJIREVISI" } } },
        }));
      assert(residu === 0, `residu data uji = ${residu}`);
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      console.error(
        `     Hapus manual:\n` +
          `       DELETE FROM "User" WHERE kode LIKE 'UJIREVISI%';\n` +
          `       DELETE FROM "Agenda" WHERE judul LIKE 'UJIREVISI%';`
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
