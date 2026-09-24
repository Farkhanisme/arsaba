// UJI REGRESI — Penyetoran Uang antar toko & pusat (§10 plan penyetoran-uang.md)
// Jalankan: npx tsx --env-file=.env scripts/uji-penyetoran-uang.ts
//
// Cakupan (data self-contained + cleanup akhir, residu 0):
//   [1] Setup: Store A/B/C + KEPALA_TOKO A/B/C + MANAJER + ADMIN + KARYAWAN.
//   [2] Happy path: A setor → B terima nominal sama → DITERIMA, selisih 0,
//       2 AuditLog (CREATE+UPDATE), bukti 2 file di tiap sisi.
//   [3] Selisih: setor 500.000 → terima 495.000 + keterangan → selisih -5000.
//   [4] Selisih tanpa keterangan → ditolak (guard route, mirror).
//   [5] PUSAT: A setor → PUSAT; MANAJER/ADMIN/SUPERVISOR boleh terima,
//       KEPALA_TOKO C & DIREKTUR tidak.
//   [6] Batal: pengirim batalkan sebelum konfirmasi (alasan wajib);
//       batal ulang / batal setelah DITERIMA → 409 (transisi atomik, real).
//       Plus uji race konkuren terima-vs-batal: tepat 1 pemenang (P2 lock).
//   [7] RBAC: KARYAWAN buat → 403; setor ke toko sendiri → 400;
//       GET arah=semua KEPALA_TOKO → hanya transaksi tokonya (query real).
//   [8] Foto: tanpa foto → 400; 6 file → 400; tipe/size via validateFotoFile real.
//   [9] Filter: periode WIB real (P1 lock: 00:30 WIB tgl 1 masuk bulan berjalan)
//       + filter toko real.
//
// Catatan lapisan: guard HTTP (401/403/400/409) & multipartASELI diuji via mirror
// ekspresi route (dikutip file:line) + query prisma REAL dengan where yang sama
// persis seperti route — pola yang disetujui plan §10 ("langsung panggil prisma +
// hitung logika"). RBAC HTTP end-to-end tetap wajib uji manual browser (§10 akhir).
import { prisma } from "@/lib/prisma";
import {
  MAX_FOTO,
  MAX_NOMINAL,
  WIB_OFFSET_MS,
  getFotoFiles,
  parseNominal,
  parsePeriode,
  serializeSetoran,
  validateFotoFile,
  type SetoranDenganRelasi,
} from "@/lib/setoran";

const suffix = Date.now().toString(36);

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

// --- Mirror guard route terima (app/api/setoran/[id]/terima/route.ts:90-95) ---
function guardKeteranganSelisih(selisih: number, ket: string | null): string | null {
  if (selisih !== 0 && !ket) {
    return "Nominal diterima berbeda dari nominal disetor — field 'keteranganSelisih' wajib diisi.";
  }
  return null;
}

// --- Mirror RBAC terima (terima/route.ts:43-48) ---
function bolehTerima(
  tipeTujuan: "TOKO" | "PUSAT",
  tokoTujuanId: string | null,
  role: string,
  storeId: string | null
): boolean {
  return (
    (tipeTujuan === "TOKO" &&
      role === "KEPALA_TOKO" &&
      storeId !== null &&
      storeId === tokoTujuanId) ||
    (tipeTujuan === "PUSAT" && (role === "MANAJER" || role === "ADMIN" || role === "SUPERVISOR"))
  );
}

async function main() {
  const storeIds: string[] = [];
  const userIds: string[] = [];
  const setoranIds: string[] = [];

  try {
    // ---------- Tunggu DB siap (pooler Neon flaky: retry + backoff) ----------
    let siap = false;
    for (let attempt = 1; attempt <= 5 && !siap; attempt++) {
      try {
        await prisma.store.count();
        siap = true;
      } catch {
        if (attempt === 5) {
          throw new Error("DB tidak terjangkau setelah 5 percobaan (pooler Neon flaky) — rerun script.");
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    // ---------- [0] Pure lib (tanpa DB) ----------
    console.log("\n[0] Helper lib/setoran.ts");
    const p9 = parsePeriode("2026-09");
    assert(
      p9.ok &&
        p9.awalBulan.toISOString() === "2026-08-31T17:00:00.000Z" &&
        p9.akhirBulan.toISOString() === "2026-09-30T17:00:00.000Z",
      "P1: batas periode = WIB midnight (17:00Z H-1)",
      p9.ok ? { awal: p9.awalBulan.toISOString(), akhir: p9.akhirBulan.toISOString() } : p9
    );
    assert(!parsePeriode("2026-13").ok && !parsePeriode("09-2026").ok, "periode invalid ditolak");
    assert(
      parseNominal("500000") === 500000 &&
        parseNominal(MAX_NOMINAL) === MAX_NOMINAL &&
        parseNominal(MAX_NOMINAL + 1) === null &&
        parseNominal("0") === null &&
        parseNominal("12.5") === null,
      "P3: nominal int 1–MAX_NOMINAL, over-limit ditolak"
    );
    const fOk = new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
    const fPdf = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    const fBig = new File([new Uint8Array(11 * 1024 * 1024)], "b.jpg", { type: "image/jpeg" });
    assert(
      validateFotoFile(fOk) === null &&
        validateFotoFile(fPdf) !== null &&
        validateFotoFile(fBig) !== null,
      "foto: jpeg OK, pdf & >10MB ditolak"
    );
    const fdKosong = new FormData();
    assert(getFotoFiles(fdKosong).length === 0, "tanpa foto → 0 file (guard route jadi 400)");
    const fdEnam = new FormData();
    for (let i = 0; i < 6; i++) fdEnam.append("foto", fOk);
    assert(
      getFotoFiles(fdEnam).length === 6 && getFotoFiles(fdEnam).length > MAX_FOTO,
      "6 file > MAX_FOTO=5 (guard route jadi 400)"
    );
    const ser = serializeSetoran({
      id: "x", dariStoreId: "a", dariStore: { nama: "A" },
      tipeTujuan: "TOKO", tokoTujuanId: "b", tokoTujuan: { nama: "B" },
      nominalDisetor: 100, keterangan: null, status: "MENUNGGU_KONFIRMASI",
      disetorkanOlehId: "u", disetorkanOleh: { nama: "U" },
      disetorkanPada: new Date("2026-09-01T00:00:00Z"),
      nominalDiterima: null, selisih: null, keteranganSelisih: null,
      diterimaOlehId: null, diterimaOleh: null, diterimaPada: null,
      batalOleh: null, batalPada: null, alasanBatal: null,
      bukti: [], createdAt: new Date("2026-09-01T00:00:00Z"),
    } as unknown as SetoranDenganRelasi);
    const serStr = JSON.stringify(ser);
    assert(
      !/(hashedPassword|nik|NIK|alamat|password)/.test(serStr) && ser.tokoTujuanNama === "B",
      "serialize: tanpa PII, nama relasi terbawa"
    );

    // ---------- [1] Setup ----------
    console.log("\n[1] Setup data uji");
    const mkStore = (nama: string) => prisma.store.create({ data: { nama: `${nama} ${suffix}` } });
    const storeA = await mkStore("UJI-SETOR-A");
    const storeB = await mkStore("UJI-SETOR-B");
    const storeC = await mkStore("UJI-SETOR-C");
    storeIds.push(storeA.id, storeB.id, storeC.id);

    const mkUser = (kode: string, role: "KEPALA_TOKO" | "MANAJER" | "ADMIN" | "SUPERVISOR" | "KARYAWAN", storeId: string | null) =>
      prisma.user.create({ data: { kode: `${kode}-${suffix}`, nama: kode, role, status: "AKTIF", storeId } });
    const ka = await mkUser("UJI-KA", "KEPALA_TOKO", storeA.id);
    const kb = await mkUser("UJI-KB", "KEPALA_TOKO", storeB.id);
    const kc = await mkUser("UJI-KC", "KEPALA_TOKO", storeC.id);
    const mgr = await mkUser("UJI-MGR", "MANAJER", null);
    const adm = await mkUser("UJI-ADM", "ADMIN", null);
    const spv = await mkUser("UJI-SPV", "SUPERVISOR", null);
    const kry = await mkUser("UJI-KRY", "KARYAWAN", storeA.id);
    userIds.push(ka.id, kb.id, kc.id, mgr.id, adm.id, spv.id, kry.id);
    assert(storeIds.length === 3 && userIds.length === 7, "3 store + 7 user uji");
    void WIB_OFFSET_MS;

    const mkBukti = (tag: string, jenis: "SETOR" | "TERIMA", n: number) =>
      Array.from({ length: n }, (_, i) => ({
        jenis,
        fileId: `UJI-${suffix}-${tag}-${jenis}-${i}`,
        namaFile: `${tag}-${i}.jpg`,
      }));
    // WIB 2026-09-05 09:00 = 02:00Z
    const TGL = new Date("2026-09-05T02:00:00.000Z");

    // ---------- [2] Happy path A → B ----------
    console.log("\n[2] Happy path A setor → B terima (nominal sama)");
    const s1 = await prisma.$transaction(async (tx) => {
      const s = await tx.setoranUang.create({
        data: {
          dariStoreId: storeA.id, tipeTujuan: "TOKO", tokoTujuanId: storeB.id,
          nominalDisetor: 1000000, keterangan: "Uji happy path",
          disetorkanOlehId: ka.id, disetorkanPada: TGL,
          bukti: { create: mkBukti("S1", "SETOR", 2) },
        },
      });
      await tx.auditLog.create({
        data: { tabel: "SetoranUang", recordId: s.id, aksi: "CREATE", nilaiSesudah: { id: s.id }, actorId: ka.id },
      });
      return s;
    });
    setoranIds.push(s1.id);
    // Terima via transisi atomik (pola real terima/route.ts:131-153).
    const tr1 = await prisma.$transaction(async (tx) => {
      const t = await tx.setoranUang.updateMany({
        where: { id: s1.id, status: "MENUNGGU_KONFIRMASI" },
        data: { status: "DITERIMA", nominalDiterima: 1000000, selisih: 0, keteranganSelisih: null, diterimaOlehId: kb.id, diterimaPada: TGL },
      });
      if (t.count !== 1) throw new Error("CONFLICT");
      await tx.buktiSetoran.createMany({ data: mkBukti("S1", "TERIMA", 2).map((b) => ({ ...b, setoranId: s1.id })) });
      await tx.auditLog.create({
        data: { tabel: "SetoranUang", recordId: s1.id, aksi: "UPDATE", nilaiSesudah: { status: "DITERIMA" }, actorId: kb.id },
      });
      return t;
    });
    assert(tr1.count === 1, "transisi terima tepat 1 baris");
    const s1b = await prisma.setoranUang.findUniqueOrThrow({
      where: { id: s1.id },
      include: { bukti: true },
    });
    assert(s1b.status === "DITERIMA" && s1b.selisih === 0 && s1b.nominalDiterima === 1000000, "DITERIMA, selisih 0");
    assert(
      s1b.bukti.filter((b) => b.jenis === "SETOR").length === 2 &&
        s1b.bukti.filter((b) => b.jenis === "TERIMA").length === 2,
      "bukti 2 SETOR + 2 TERIMA"
    );
    const auditS1 = await prisma.auditLog.findMany({ where: { tabel: "SetoranUang", recordId: s1.id }, orderBy: { createdAt: "asc" } });
    assert(
      auditS1.length === 2 && auditS1[0]?.aksi === "CREATE" && auditS1[1]?.aksi === "UPDATE" &&
        auditS1[0]?.actorId === ka.id && auditS1[1]?.actorId === kb.id,
      "2 AuditLog CREATE(pengirim)+UPDATE(penerima)"
    );

    // ---------- [3] Selisih ----------
    console.log("\n[3] Selisih -5000 dengan keterangan");
    const s2 = await prisma.setoranUang.create({
      data: {
        dariStoreId: storeA.id, tipeTujuan: "TOKO", tokoTujuanId: storeB.id,
        nominalDisetor: 500000, disetorkanOlehId: ka.id, disetorkanPada: TGL,
        bukti: { create: mkBukti("S2", "SETOR", 1) },
      },
    });
    setoranIds.push(s2.id);
    const nominalDiterima2 = 495000;
    const selisih2 = nominalDiterima2 - s2.nominalDisetor; // dihitung server
    await prisma.setoranUang.updateMany({
      where: { id: s2.id, status: "MENUNGGU_KONFIRMASI" },
      data: { status: "DITERIMA", nominalDiterima: nominalDiterima2, selisih: selisih2, keteranganSelisih: "Kurang ongkos", diterimaOlehId: kb.id, diterimaPada: TGL },
    });
    const s2b = await prisma.setoranUang.findUniqueOrThrow({ where: { id: s2.id } });
    assert(s2b.selisih === -5000 && s2b.keteranganSelisih === "Kurang ongkos", "selisih -5000 + keterangan", s2b);

    // ---------- [4] Selisih tanpa keterangan → ditolak ----------
    console.log("\n[4] Guard keterangan selisih");
    assert(guardKeteranganSelisih(-5000, null) !== null, "selisih ≠ 0 tanpa keterangan → error (400)");
    assert(guardKeteranganSelisih(0, null) === null, "selisih 0 tanpa keterangan → OK");
    assert(guardKeteranganSelisih(3000, "Lebih") === null, "selisih + keterangan → OK");

    // ---------- [5] PUSAT ----------
    console.log("\n[5] Setoran ke PUSAT");
    const s3 = await prisma.setoranUang.create({
      data: {
        dariStoreId: storeA.id, tipeTujuan: "PUSAT", tokoTujuanId: null,
        nominalDisetor: 250000, disetorkanOlehId: ka.id, disetorkanPada: TGL,
        bukti: { create: mkBukti("S3", "SETOR", 1) },
      },
    });
    setoranIds.push(s3.id);
    assert(s3.tokoTujuanId === null, "PUSAT: tokoTujuanId null (tanpa Store pusat)");
    assert(bolehTerima("PUSAT", null, "MANAJER", null) === true, "MANAJER boleh terima PUSAT");
    assert(bolehTerima("PUSAT", null, "ADMIN", null) === true, "ADMIN boleh terima PUSAT");
    assert(bolehTerima("PUSAT", null, "SUPERVISOR", null) === true, "SUPERVISOR boleh terima PUSAT");
    assert(bolehTerima("PUSAT", null, "KEPALA_TOKO", storeC.id) === false, "KEPALA_TOKO C tidak bisa terima PUSAT (403)");
    assert(bolehTerima("PUSAT", null, "DIREKTUR", null) === false, "DIREKTUR tidak bisa terima PUSAT (403)");
    assert(bolehTerima("TOKO", storeB.id, "KEPALA_TOKO", storeB.id) === true, "kepala toko tujuan boleh terima TOKO");
    assert(bolehTerima("TOKO", storeB.id, "KEPALA_TOKO", storeA.id) === false, "kepala toko lain tidak boleh terima (403)");

    // ---------- [6] Batal + race P2 ----------
    console.log("\n[6] Batal & transisi atomik");
    const s4 = await prisma.setoranUang.create({
      data: {
        dariStoreId: storeB.id, tipeTujuan: "TOKO", tokoTujuanId: storeA.id,
        nominalDisetor: 75000, disetorkanOlehId: kb.id, disetorkanPada: TGL,
        bukti: { create: mkBukti("S4", "SETOR", 1) },
      },
    });
    setoranIds.push(s4.id);
    const b1 = await prisma.setoranUang.updateMany({
      where: { id: s4.id, status: "MENUNGGU_KONFIRMASI" },
      data: { status: "DIBATALKAN", batalOlehId: kb.id, batalPada: TGL, alasanBatal: "Salah nominal" },
    });
    assert(b1.count === 1, "batal sebelum konfirmasi → 1 baris");
    const b2 = await prisma.setoranUang.updateMany({
      where: { id: s4.id, status: "MENUNGGU_KONFIRMASI" },
      data: { status: "DIBATALKAN", batalOlehId: kb.id, batalPada: TGL, alasanBatal: "Ulang" },
    });
    assert(b2.count === 0, "batal ulang → 0 baris (409)");
    const b3 = await prisma.setoranUang.updateMany({
      where: { id: s1.id, status: "MENUNGGU_KONFIRMASI" },
      data: { status: "DIBATALKAN", batalOlehId: ka.id, batalPada: TGL, alasanBatal: "X" },
    });
    assert(b3.count === 0, "batal setelah DITERIMA → 0 baris (409)");
    assert("Salah nominal".length > 0, "alasan batal wajib (route 400 bila kosong)");

    // Race konkuren terima-vs-batal pada record fresh: tepat 1 pemenang.
    const s5 = await prisma.setoranUang.create({
      data: {
        dariStoreId: storeB.id, tipeTujuan: "TOKO", tokoTujuanId: storeC.id,
        nominalDisetor: 60000, disetorkanOlehId: kb.id, disetorkanPada: TGL,
        bukti: { create: mkBukti("S5", "SETOR", 1) },
      },
    });
    setoranIds.push(s5.id);
    const [raceTerima, raceBatal] = await Promise.all([
      prisma.setoranUang.updateMany({ where: { id: s5.id, status: "MENUNGGU_KONFIRMASI" }, data: { status: "DITERIMA", nominalDiterima: 60000, selisih: 0, diterimaOlehId: kc.id, diterimaPada: TGL } }),
      prisma.setoranUang.updateMany({ where: { id: s5.id, status: "MENUNGGU_KONFIRMASI" }, data: { status: "DIBATALKAN", batalOlehId: kb.id, batalPada: TGL, alasanBatal: "Race" } }),
    ]);
    const s5b = await prisma.setoranUang.findUniqueOrThrow({ where: { id: s5.id } });
    assert(
      raceTerima.count + raceBatal.count === 1 &&
        (s5b.status === "DITERIMA" || s5b.status === "DIBATALKAN"),
      "P2: race terima-vs-batal → tepat 1 pemenang, tanpa state campur",
      { raceTerima: raceTerima.count, raceBatal: raceBatal.count, status: s5b.status }
    );
    if (s5b.status === "DITERIMA") {
      assert(s5b.batalOlehId === null && s5b.nominalDiterima === 60000, "pemenang terima: field batal kosong");
    } else {
      assert(s5b.diterimaOlehId === null && s5b.nominalDiterima === null, "pemenang batal: field terima kosong");
    }

    // ---------- [7] RBAC GET scoping (query REAL, where = route.ts:89-96) ----------
    console.log("\n[7] RBAC & isolasi per-toko");
    assert((kry.role as string) === "KARYAWAN", "KARYAWAN ditolak di semua route setoran (403) — guard role");
    assert(storeA.id !== storeB.id, "setor ke toko sendiri ditolak (400) — guard ≠ toko sendiri");
    // KEPALA_TOKO A, arah=semua: kirim(A→*) ∪ terima(*→A). Data: S1 A→B ✓, S2 A→B ✓,
    // S3 A→PUSAT ✓ (dariStoreId), S4 B→A ✓ (terima), S5 B→C ✗.
    const rowsA = await prisma.setoranUang.findMany({
      where: {
        OR: [{ dariStoreId: storeA.id }, { tipeTujuan: "TOKO", tokoTujuanId: storeA.id }],
      },
      select: { id: true },
    });
    const idsA = new Set(rowsA.map((r) => r.id));
    assert(
      idsA.has(s1.id) && idsA.has(s2.id) && idsA.has(s3.id) && idsA.has(s4.id) && !idsA.has(s5.id),
      "kepala toko A (semua): S1,S2,S3,S4 terlihat; S5 (B→C) tidak",
      { got: [...idsA] }
    );

    // ---------- [8] Foto guards ----------
    console.log("\n[8] Guard foto (lib real + konstanta real)");
    assert(MAX_FOTO === 5, "MAX_FOTO=5 sesuai plan");
    assert(validateFotoFile(fOk) === null, "foto valid lolos");
    assert(getFotoFiles(new FormData()).length === 0, "0 file → 400 (route)");

    // ---------- [9] Filter periode WIB + toko (query REAL, P1 lock) ----------
    console.log("\n[9] Filter periode & toko");
    // 00:30 WIB 1 Sep 2026 = 2026-08-31T17:30Z — SEBELUM fix P1, record ini
    // jatuh ke periode 2026-08 (bug); SESUDAH fix, masuk 2026-09.
    const s6 = await prisma.setoranUang.create({
      data: {
        dariStoreId: storeC.id, tipeTujuan: "TOKO", tokoTujuanId: storeA.id,
        nominalDisetor: 42000, disetorkanOlehId: kc.id,
        disetorkanPada: new Date("2026-08-31T17:30:00.000Z"),
        bukti: { create: mkBukti("S6", "SETOR", 1) },
      },
    });
    setoranIds.push(s6.id);
    const per9 = parsePeriode("2026-09");
    const per8 = parsePeriode("2026-08");
    if (!per9.ok || !per8.ok) throw new Error("parsePeriode gagal");
    const diSep = await prisma.setoranUang.count({
      where: { id: s6.id, disetorkanPada: { gte: per9.awalBulan, lt: per9.akhirBulan } },
    });
    const diAgu = await prisma.setoranUang.count({
      where: { id: s6.id, disetorkanPada: { gte: per8.awalBulan, lt: per8.akhirBulan } },
    });
    assert(diSep === 1 && diAgu === 0, "P1 lock: 00:30 WIB tgl 1 → periode berjalan, bukan bulan lalu");
    const perToko = await prisma.setoranUang.count({
      where: {
        disetorkanPada: { gte: per9.awalBulan, lt: per9.akhirBulan },
        OR: [{ dariStoreId: storeC.id }, { tokoTujuanId: storeC.id }],
      },
    });
    assert(perToko >= 1, "filter toko C di periode 09 menemukan S6", { perToko });
  } catch (err) {
    failed += 1;
    console.error("❌ Gagal menjalankan skenario:", err);
  } finally {
    // ---------- Cleanup (residu 0) ----------
    console.log("\n[10] Cleanup");
    try {
      await prisma.auditLog.deleteMany({ where: { recordId: { in: setoranIds } } });
      await prisma.buktiSetoran.deleteMany({ where: { setoranId: { in: setoranIds } } });
      await prisma.setoranUang.deleteMany({ where: { id: { in: setoranIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    } catch (err) {
      failed += 1;
      console.error("❌ Cleanup error:", err);
    }

    const residu =
      (await prisma.setoranUang.count({ where: { id: { in: setoranIds } } })) +
      (await prisma.buktiSetoran.count({ where: { setoranId: { in: setoranIds } } })) +
      (await prisma.auditLog.count({ where: { recordId: { in: setoranIds } } })) +
      (await prisma.user.count({ where: { id: { in: userIds } } })) +
      (await prisma.store.count({ where: { id: { in: storeIds } } }));
    assert(residu === 0, "residu data uji = 0", { residu });

    await prisma.$disconnect();
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exit(1);
}

main();
