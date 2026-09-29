// UJI REGRESI — Guard "harus selesai sebelum disetujui" (P0-2)
//
// MASALAH
//   `PATCH /api/agenda/[id]/verify` hanya mengecek `status === "PENDING_VERIFIKASI"`.
//   Supervisor bisa menyetujui turunan template yang BELUM dikerjakan.
//
//   Rantai akibatnya:
//     1. Status jadi DIVERIFIKASI.
//     2. Karyawan menekan "Selesai" -> 409, karena `selesai/route.ts` hanya
//        menerima status PENDING. `diselesaikanPada` tidak bisa diisi lagi.
//     3. `payroll/generate` hanya menghitung agenda dengan `diselesaikanPada`
//        terisi. Agenda ini TIDAK PERNAH masuk gaji, di bulan mana pun.
//     4. Manajer tetap boleh set nominal -> payslip menampilkan
//        "Bonus Agenda Rp 500.000" yang tidak akan pernah dibayar.
//     5. Tidak ada endpoint pemulihan dan tidak ada revisi untuk Agenda.
//
// Cakupan:
//   [1] Regresi pembuktian: approve tanpa selesai -> 409, dan yang menentukan
//       adalah bonus-nya masuk gaji.
//   [2] Setelah karyawan "Selesai" -> approve berhasil, bonus masuk gaji.
//   [3] MENOLAK tanpa selesai tetap BOLEH (tugas dibatalkan, bukan gift).
//   [4] Template master (tanpa target) tetap bisa diverifikasi — tidak punya
//       konsep "Selesai".
//   [5] Assignment ke TOKO tetap bisa diverifikasi — tidak ada karyawan yang
//       menekan Selesai, dan tidak memengaruhi gaji.
//
// Butuh: npm run dev berjalan di terminal lain.

import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { login } from "./http-test";

const BASE = "http://localhost:3000";
const prisma = dbClient(prismaRaw);
const PREFIX = `UJISELESAI-${Date.now().toString(36).toUpperCase()}`;
/**
 * Periode = bulan BERJALAN.
 *
 * `diselesaikanPale` diisi `new Date()` server, jadi selalu bulan hari ini.
 * Kalau test meng-hardcode bulan lain, bonus tidak akan terhitung — dan itu
 * kesalahannya di test, bukan di payroll.
 */
function periodeBerjalan(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
const PERIODE = periodeBerjalan();
const JPEG_PX = new Uint8Array(
  readFileSync(new URL("./fixtures/probe-1px.jpg", import.meta.url))
);

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.error(`  ❌ ${label}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`); }
}

async function req(jar: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { cookie: jar } };
  if (body !== undefined) {
    init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}${path}`, init);
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) { console.error("❌ SEED_PASSWORD belum di-set."); process.exitCode = 1; return; }

  // `POST /api/payroll/generate` itu GLOBAL: dia memproses SEMUA karyawan aktif
  // yang punya `tipePerhitunganGaji`, bukan cuma karyawan uji. Kalau test
  // memanggilnya untuk periode yang belum ada di DB, it'll membuat baris
  // payroll untuk 9 karyawan nyata — dan cleanup per-user tidak akan
  // menyentuhnya, jadi DB jadi tercemar diam-diam.
  //
  // Jadi: catat payroll yang SUDAH ADA untuk periode ini SEBELUM memanggil
  // generate, lalu di blok cleanup hapus yang bukan bagian dari snapshot itu.
  //
  // PENTING: snapshot TIDAK boleh dibungkus `.catch(() => [])`. Kalau koneksi
  // putus saat snapshot, array kosong akan dianggap "tidak ada payroll
  // sebelumnya" — dan cleanup akan menghapus SEMUA payroll periode itu,
  // termasuk yang sudah ada sebelum test. Itu sudah pernah terjadi sekali.
  // Kalau snapshot gagal, test HARUS berhenti.
  const periodeDate = new Date(`${PERIODE}-01T00:00:00.000Z`);
  let idPayrollSebelum: Set<string>;
  try {
    await tungguDB(prismaRaw);
    const payrollSebelum = await prisma.payroll.findMany({
      where: { periode: periodeDate },
      select: { id: true },
    });
    idPayrollSebelum = new Set(payrollSebelum.map((p) => p.id));
  } catch (e) {
    console.error(
      "❌ Gagal mengambil snapshot payroll sebelum test. Test dibatalkan supaya tidak menghapus payroll yang bukan miliknya.",
      e instanceof Error ? e.message : e
    );
    await prismaRaw.$disconnect();
    process.exitCode = 1;
    return;
  }

  try {
    const jarMGR = await login("MGR-001", seedPass);

    // ---------- Fixture ----------
    // User uji butuh password agar bisa login lewat helper `login()`.
    const hashedPassword = await bcrypt.hash(seedPass, 10);
    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`, nama: "Uji Selesai", role: "KARYAWAN", status: "AKTIF",
        tipePerhitunganGaji: "HARIAN", tarifPerHari: 100_000,
        hashedPassword,
      },
    });
    const jarKAR = await login(kar.kode, seedPass);

    // Helper: buat agenda fresh berstatus PENDING untuk scenario tertentu.
    const buatAgenda = async (label: string) =>
      prisma.agenda.create({
        data: {
          judul: `${PREFIX} ${label}`, deskripsi: "uji", sumber: "TEMPLATE_PUSAT",
          status: "PENDING_VERIFIKASI", targetEmployeeId: kar.id, targetStoreId: null,
          templateId: null, createdById: kar.id, deadline: null, nominal: 250_000,
          diselesaikanPada: null,
        },
      });

    // ============================================================
    console.log("\n[1] Approve SEBELUM selesai -> 409");
    const belum = await buatAgenda("belum selesai");
    let r = await req(jarMGR, "PATCH", `/api/agenda/${belum.id}/verify`, { action: "approve" });
    assert(r.status === 409, "approve tanpa selesai -> 409", { status: r.status });
    assert(
      typeof r.body.error === "string" && (r.body.error as string).includes("Selesai"),
      "pesan menyebut harus menunggu karyawan menekan Selesai",
      r.body.error
    );
    const masihP = await prisma.agenda.findUnique({
      where: { id: belum.id }, select: { status: true, diselesaikanPada: true },
    });
    assert(
      masihP?.status === "PENDING_VERIFIKASI",
      "status TIDAK berubah ke DIVERIFIKASI",
      masihP?.status
    );
    assert(
      masihP?.diselesaikanPada === null,
      "diselesaikanPada masih null -> masih bisa diisi setelahnya",
      masihP?.diselesaikanPada
    );

    // ============================================================
    console.log("\n[2] Setelah karyawan Selesai -> approve OK, bonus masuk gaji");
    // Bukti dummy: yang penting endpoint selesai jalan.
    const fd = new FormData();
    fd.set("fotoAfter", new File([JPEG_PX], "a.jpg", { type: "image/jpeg" }));
    const selesai = await fetch(`${BASE}/api/agenda/${belum.id}/selesai`, {
      method: "POST", headers: { cookie: jarKAR }, body: fd,
    });
    assert(selesai.status === 200, "karyawan bisa tekan Selesai", selesai.status);
    const setelahSelesai = await prisma.agenda.findUnique({
      where: { id: belum.id }, select: { diselesaikanPada: true },
    });
    assert(
      !!setelahSelesai?.diselesaikanPada,
      "diselesaikanPada terisi",
      setelahSelesai?.diselesaikanPada?.toISOString()
    );

    r = await req(jarMGR, "PATCH", `/api/agenda/${belum.id}/verify`, { action: "approve" });
    assert(r.status === 200, "setelah Selesai, approve -> 200", { status: r.status, err: r.body.error });

    // Generate -> bonus harus masuk gaji karyawan ini.
    r = await req(jarMGR, "POST", "/api/payroll/generate", { periode: PERIODE });
    // Kalau generate-nya sendiri gagal (mis. P1001 dari Neon pooler), assert
    // di bawah akan melaporkan "employeeId tidak ada di hasil generate" — itu
    // menyesatkan, karena masalahnya bukan agenda. Stop di sini dengan jelas.
    if (r.status !== 200) {
      assert(
        false,
        "generate payroll berhasil (kalau gagal, sisa test tidak bermakna)",
        { status: r.status, err: r.body.error }
      );
      throw new Error(`generate gagal (HTTP ${r.status}) — sisa test dilewati`);
    }
    const items = r.body.items as
      | { employeeId: string; totalBonusAgenda: number }[]
      | undefined;
    const barisKar = items?.find((x) => x.employeeId === kar.id);
    assert(
      barisKar !== undefined,
      `employeeId karyawan uji ada di hasil generate (periode ${PERIODE})`,
      { totalItems: items?.length ?? -1, karId: kar.id }
    );
    assert(
      barisKar?.totalBonusAgenda === 250_000,
      "bonus 250.000 masuk gaji",
      barisKar?.totalBonusAgenda
    );

    // ============================================================
    console.log("\n[3] MENOLAK tanpa selesai tetap boleh");
    const ditolak = await buatAgenda("ditolak tanpa selesai");
    r = await req(jarMGR, "PATCH", `/api/agenda/${ditolak.id}/verify`, {
      action: "reject", reason: "tugas dibatalkan, tidak jadi dikerjakan",
    });
    assert(r.status === 200, "tolak tanpa selesai -> 200", { status: r.status, err: r.body.error });
    const stD = await prisma.agenda.findUnique({ where: { id: ditolak.id }, select: { status: true } });
    assert(stD?.status === "DITOLAK", "status = DITOLAK", stD?.status);

    // ============================================================
    console.log("\n[4] Template MASTER tetap bisa diverifikasi");
    const master = await prisma.agenda.create({
      data: {
        judul: `${PREFIX} master`, deskripsi: "uji", sumber: "TEMPLATE_PUSAT",
        status: "PENDING_VERIFIKASI", targetEmployeeId: null, targetStoreId: null,
        templateId: null, createdById: kar.id, deadline: null, nominal: null,
        diselesaikanPada: null,
      },
    });
    r = await req(jarMGR, "PATCH", `/api/agenda/${master.id}/verify`, { action: "approve" });
    assert(
      r.status === 200,
      "master tanpa target -> approve 200 (tidak punya konsep Selesai)",
      { status: r.status, err: r.body.error }
    );

    // ============================================================
    console.log("\n[5] Assignment ke TOKO tetap bisa diverifikasi");
    const store = await prisma.store.create({ data: { nama: `${PREFIX}-TOKO` } });
    const keToko = await prisma.agenda.create({
      data: {
        judul: `${PREFIX} ke toko`, deskripsi: "uji", sumber: "TEMPLATE_PUSAT",
        status: "PENDING_VERIFIKASI", targetEmployeeId: null, targetStoreId: store.id,
        templateId: null, createdById: kar.id, deadline: null, nominal: 100_000,
        diselesaikanPada: null,
      },
    });
    r = await req(jarMGR, "PATCH", `/api/agenda/${keToko.id}/verify`, { action: "approve" });
    assert(
      r.status === 200,
      "assignment ke toko -> approve 200 (tidak ada karyawan pencet Selesai)",
      { status: r.status, err: r.body.error }
    );

    // ============================================================
    console.log("\n[6] Rejekan: DITOLAK tidak bisa di-approve ulang");
    r = await req(jarMGR, "PATCH", `/api/agenda/${ditolak.id}/verify`, { action: "approve" });
    assert(r.status === 409, "agenda DITOLAK -> approve 409", r.status);
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[7] Cleanup");
    try {
      const agendas = await prisma.agenda.findMany({
        where: { judul: { startsWith: PREFIX } }, select: { id: true },
      });
      for (const a of agendas) {
        await prisma.auditLog.deleteMany({ where: { tabel: "Agenda", recordId: a.id } });
      }
      await prisma.agenda.deleteMany({ where: { judul: { startsWith: PREFIX } } });
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } }, select: { id: true },
      });
      for (const u of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
        await prisma.attendance.deleteMany({ where: { employeeId: u.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: u.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: u.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
      await prisma.store.deleteMany({ where: { nama: { startsWith: PREFIX } } });

      // Bersihkan payroll yang dibuat oleh `generate` untuk karyawan LAIN —
      // lihat catatan di awal file. Hanya hapus yang tidak ada sebelum test.
      const payrollSesudah = await prismaRaw.payroll.findMany({
        where: { periode: periodeDate },
        select: { id: true },
      });
      const sisa = payrollSesudah.filter((p) => !idPayrollSebelum.has(p.id));
      for (const p of sisa) {
        await prismaRaw.auditLog.deleteMany({
          where: { tabel: "Payroll", recordId: p.id },
        });
      }
      if (sisa.length > 0) {
        await prismaRaw.payroll.deleteMany({ where: { id: { in: sisa.map((p) => p.id) } } });
        console.log(`  🧹 ${sisa.length} payroll sampingan dibersihkan (dari generate global)`);
      }

      const residu = await prisma.agenda.count({ where: { judul: { startsWith: PREFIX } } });
      const residuU = await prisma.user.count({ where: { kode: { startsWith: PREFIX } } });
      assert(residu + residuU === 0, `residu = ${residu + residuU}`, { residu, residuU });
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
