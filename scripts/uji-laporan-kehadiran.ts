// UJI REGRESI — Laporan Kehadiran + Izin (§8.1)
// Jalankan: npx tsx --env-file=.env scripts/uji-laporan-kehadiran.ts
//
// Memanggil komputasi ASLI (lib/laporan-kehadiran.ts) terhadap dataset uji yang
// dibuat & dibersihkan sendiri (residu 0). Rekonstruksi dari master plan
// (laporan-kehadiran.md §A.6) + perbaikan-cakupan-a.md (§Uji) + polish-p4.
// Menutup perilaku terdokumentasi:
//   - Baseline jadwal (ShiftAssignment APPROVED), hadir (DIVERIFIKASI, global),
//     izin efektif (jadwal ∩ izin \ hadir — P2), tanpa-ket (turunan), di-luar-jadwal,
//     hadir-fisik per toko, % kehadiran.
//   - PAM lintas toko tetap "berangkat"; karyawan tanpa jadwal → persen null.
//   - Lensa ganda (P1): karyawan tampil di toko baseline dan toko terdaftar.
//
// Periode uji: 2026-08 (bulan lampau) agar tidak bentrok dengan data berjalan.
import { prisma } from "@/lib/prisma";
import {
  getLaporanKehadiran,
  getRincianKehadiran,
  type LaporanKaryawan,
} from "@/lib/laporan-kehadiran";

const PERIODE = "2026-08";
const AWAL_BULAN = new Date(Date.UTC(2026, 7, 1));
const AKHIR_BULAN = new Date(Date.UTC(2026, 8, 1));

const suffix = Date.now().toString(36);
const tgl = (n: number) => new Date(Date.UTC(2026, 7, n)); // tgl ke-n Agustus 2026

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${label}${detail !== undefined ? JSON.stringify(detail) : ""}`);
  }
}

function carik(rows: LaporanKaryawan[], kode: string): LaporanKaryawan | undefined {
  return rows.find((k) => k.kode.startsWith(kode));
}

async function main() {
  let storeAId = "";
  let storeBId = "";
  const anggotaIds: string[] = []; // karyawan uji (untuk cleanup & cek residu)

  try {
    // ---------- Tunggu DB siap (pooler Neon flaky: retry + backoff) ----------
    let siap = false;
    for (let attempt = 1; attempt <= 5 && !siap; attempt++) {
      try {
        await prisma.store.count();
        siap = true;
      } catch {
        if (attempt === 5) {
          throw new Error(
            "DB tidak terjangkau setelah 5 percobaan (pooler Neon flaky) — rerun script."
          );
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    // ---------- Set up data uji ----------
    const aktor = await prisma.user.create({
      data: { kode: `UJI-ACT-${suffix}`, nama: "Aktor Uji", role: "SUPERVISOR", status: "AKTIF" },
    });
    anggotaIds.push(aktor.id);

    const storeA = await prisma.store.create({ data: { nama: `UJI A ${suffix}` } });
    const storeB = await prisma.store.create({ data: { nama: `UJI B ${suffix}` } });
    storeAId = storeA.id;
    storeBId = storeB.id;

    const mkKaryawan = (kode: string, storeId: string, tipe: "HARIAN" | "BULANAN") =>
      prisma.user.create({
        data: { kode: `${kode}-${suffix}`, nama: kode, role: "KARYAWAN", status: "AKTIF", tipePerhitunganGaji: tipe, storeId },
      });

    const uji001 = await mkKaryawan("UJI-001", storeAId, "HARIAN");
    const uji002 = await mkKaryawan("UJI-002", storeAId, "BULANAN");
    const uji003 = await mkKaryawan("UJI-003", storeAId, "HARIAN");
    const uji004 = await mkKaryawan("UJI-004", storeBId, "HARIAN"); // ditugaskan di A, terdaftar di B
    const uji005 = await mkKaryawan("UJI-005", storeAId, "HARIAN"); // tanpa jadwal & tanpa hadir
    anggotaIds.push(uji001.id, uji002.id, uji003.id, uji004.id, uji005.id);

    // Instance APPROVED (1 per tanggal) + assignment per karyawan.
    const mkInstance = (storeId: string, tanggal: Date) =>
      prisma.shiftInstance.create({
        data: {
          storeId, tanggal,
          jamMulai: tanggal, jamSelesai: tanggal,
          statusJadwal: "APPROVED", sumberJadwal: "AUTO",
          createdById: aktor.id, approvedById: aktor.id, approvedAt: tanggal,
        },
      });

    const mkAssignment = (instId: string, employeeId: string, tanggal: Date) =>
      prisma.shiftAssignment.create({
        data: { shiftInstanceId: instId, employeeId, segmen: "NORMAL", jamMulai: tanggal, jamSelesai: tanggal, createdById: aktor.id },
      });

    // Hari uji: D1..D5 (3–7 Ags 2026). D5 = off-day untuk UJI-003 (tanpa assignment).
    const instA1 = await mkInstance(storeAId, tgl(3));
    const instA2 = await mkInstance(storeAId, tgl(4));
    const instA3 = await mkInstance(storeAId, tgl(5));
    const instA4 = await mkInstance(storeAId, tgl(6));

    await mkAssignment(instA1.id, uji001.id, tgl(3));
    await mkAssignment(instA2.id, uji001.id, tgl(4));
    await mkAssignment(instA1.id, uji002.id, tgl(3));
    await mkAssignment(instA2.id, uji002.id, tgl(4));
    await mkAssignment(instA3.id, uji002.id, tgl(5));
    await mkAssignment(instA1.id, uji003.id, tgl(3));
    await mkAssignment(instA2.id, uji003.id, tgl(4));
    await mkAssignment(instA3.id, uji003.id, tgl(5));
    await mkAssignment(instA4.id, uji003.id, tgl(6));
    await mkAssignment(instA1.id, uji004.id, tgl(3));
    await mkAssignment(instA2.id, uji004.id, tgl(4));

    // Attendance DIVERIFIKASI.
    const mkHadir = (employeeId: string, storeId: string, tanggal: Date, isPam = false) =>
      prisma.attendance.create({
        data: {
          employeeId, storeId, tanggalShift: tanggal,
          absenMasuk: tanggal, absenKeluar: tanggal, fotoMasukDiambilPada: tanggal,
          statusMasuk: "DIVERIFIKASI", statusKeluar: "DIVERIFIKASI", isPam,
        },
      });

    await mkHadir(uji001.id, storeAId, tgl(3));
    await mkHadir(uji001.id, storeAId, tgl(4));
    await mkHadir(uji002.id, storeAId, tgl(3));
    await mkHadir(uji002.id, storeAId, tgl(4));
    await mkHadir(uji002.id, storeBId, tgl(5), true); // PAM di toko lain
    await mkHadir(uji003.id, storeAId, tgl(3));
    await mkHadir(uji003.id, storeAId, tgl(4));
    await mkHadir(uji004.id, storeAId, tgl(3));
    await mkHadir(uji004.id, storeAId, tgl(4));

    // Izin:
    // - UJI-003: D4 (hari jadwal, tidak dihadiri → efektif 1) + D5 (off-day → TIDAK dihitung).
    // - UJI-004: D1 (hari jadwal tapi dihadiri → hadir menang → TIDAK dihitung).
    await prisma.izin.createMany({
      data: [
        { employeeId: uji003.id, tanggal: tgl(6), alasan: "Uji izin terjadwal tak hadir (P2c)" },
        { employeeId: uji003.id, tanggal: tgl(7), alasan: "Uji izin off-day (P2a)" },
        { employeeId: uji004.id, tanggal: tgl(3), alasan: "Uji izin di hari hadir (P2b)" },
      ],
    });

    // ---------- Komputasi (lib ASLI) ----------
    const lap = await getLaporanKehadiran({ periode: PERIODE, awalBulan: AWAL_BULAN, akhirBulan: AKHIR_BULAN });
    const lapA = await getLaporanKehadiran({ periode: PERIODE, awalBulan: AWAL_BULAN, akhirBulan: AKHIR_BULAN, storeId: storeAId });

    const repA = lap.stores.find((s) => s.storeId === storeAId);
    const repB = lap.stores.find((s) => s.storeId === storeBId);

    console.log(`\n[1] Laporan periode ${PERIODE} — setups`);

    assert(
      lap.daftarToko.some((t) => t.id === storeAId) && lap.daftarToko.some((t) => t.id === storeBId),
      "daftarToko memuat kedua toko uji"
    );
    assert(
      !repA || !repB ? false : repA.totalKaryawan === 5 && repB.totalKaryawan === 1,
      `totalKaryawan — toko A=5 (UJI-001..005), toko B=1 (UJI-004)`,
      { gotA: repA?.totalKaryawan, gotB: repB?.totalKaryawan }
    );
    assert(
      lapA.stores.length === 1 && lapA.stores[0]?.storeId === storeAId,
      "filter storeId=A → hanya 1 toko"
    );

    console.log(`\n[2] Per karyawan — lensa toko`);

    const k001 = carik(repA!.karyawan, "UJI-001");
    assert(
      k001?.jadwalHari === 2 && k001?.hariHadir === 2 && k001?.hariIzin === 0 &&
        k001?.hariTanpaKeterangan === 0 && k001?.persentaseKehadiran === 100,
      "UJI-001 hadir penuh → jadwal 2, hadir 2, izin 0, tanpa-ket 0, %100", k001
    );

    const k002 = carik(repA!.karyawan, "UJI-002");
    assert(
      k002?.jadwalHari === 3 && k002?.hariHadir === 3 && k002?.hariIzin === 0 &&
        k002?.hariTanpaKeterangan === 0 && k002?.hariHadirFisik === 2 &&
        k002?.tipePerhitunganGaji === "BULANAN",
      "UJI-002 PAM lintas toko → jadwal 3, hadir 3 (PAM berangkat), tanpa-ket 0, fisik A = 2, tipe BULANAN", k002
    );

    const k003 = carik(repA!.karyawan, "UJI-003");
    assert(
      k003?.jadwalHari === 4 && k003?.hariHadir === 2 && k003?.hariIzin === 1 &&
        k003?.hariTanpaKeterangan === 1 && k003?.persentaseKehadiran === 50,
      "UJI-003 → jadwal 4, hadir 2, izin 1 (P2c), tanpa-ket 1, %50 — izin off-day D5 TIDAK dihitung (P2a)", k003
    );

    const k004A = carik(repA!.karyawan, "UJI-004");
    const k004B = carik(repB!.karyawan, "UJI-004");
    assert(
      k004A?.jadwalHari === 2 && k004A?.hariHadir === 2 && k004A?.hariIzin === 0,
      "UJI-004 lensa toko A (baseline) → jadwal 2, hadir 2, izin 0 (izin D1 batal karena hadir — P2b)", k004A
    );
    assert(
      !!k004B && k004B?.jadwalHari === 0 && k004B?.hariHadir === 2 &&
        k004B?.hariDiLuarJadwal === 2 && k004B?.hariIzin === 0 && k004B?.persentaseKehadiran === null,
      "UJI-004 lensa toko B (terdaftar) → jadwal 0, hadir 2, di-luar-jadwal 2, % null (P1: tampil 2 toko)", k004B
    );

    const k005 = carik(repA!.karyawan, "UJI-005");
    assert(
      k005?.jadwalHari === 0 && k005?.hariHadir === 0 && k005?.persentaseKehadiran === null,
      "UJI-005 tanpa jadwal & tanpa hadir → 0/0, % null (edge §A.1.6)", k005
    );

    console.log(`\n[3] Total per toko & agregasi`);

    assert(
      repA?.totalHariJadwal === 11 && repA?.totalHariHadir === 9 &&
        repA?.totalHariIzin === 1 && repA?.totalHariTidakHadir === 2 &&
        repA?.totalHariTanpaKeterangan === 1 && repA?.persentaseKehadiran === 81.8,
      "Toko A: jadwal 11, hadir 9, izin 1, tidak-hadir 2, tanpa-ket 1, %81.8",
      { got: repA }
    );
    assert(
      repB?.totalHariJadwal === 0 && repB?.totalHariHadir === 2 && repB?.totalHariTanpaKeterangan === 0,
      "Toko B: jadwal 0, hadir 2, tanpa-ket 0",
      { got: repB }
    );

    // Agregasi "Semua Toko" = penjumlahan lensa per toko (P1: double count by design).
    const sum = (f: (s: typeof repA) => number) => lap.stores.reduce((acc, s) => acc + f(s), 0);
    const sumJadwal = sum((s) => s!.totalHariJadwal);
    const sumHadir = sum((s) => s!.totalHariHadir);
    const sumIzin = sum((s) => s!.totalHariIzin);
    const sumTanpaKet = sum((s) => s!.totalHariTanpaKeterangan);
    assert(
      sumJadwal === 11 && sumHadir === 11 && sumIzin === 1 && sumTanpaKet === 1,
      "Agregasi lintas toko: jadwal 11, hadir 11 (UJI-004 2x — P1 doc), izin 1, tanpa-ket 1",
      { sumJadwal, sumHadir, sumIzin, sumTanpaKet }
    );
    console.log(
      "  ℹ P1-doc: hadir lintas toko = 11 > hadir unik perusahaan = 9 (UJI-004 dihitung di toko A dan B) — disengaja, lihat spec §8.1."
    );

    console.log(`\n[5] Rincian per tanggal (Scope B.1) + invarian vs agregat`);
    const fmtTgl = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;
    const rinArgs = (employeeId: string, sid: string) => ({
      employeeId,
      periode: PERIODE,
      awalBulan: AWAL_BULAN,
      akhirBulan: AKHIR_BULAN,
      storeId: sid,
    });

    // UJI-003 lensa A: union jadwal{D1..D4} ∪ hadir{D1,D2} = 4 baris.
    const rin003 = await getRincianKehadiran(rinArgs(uji003.id, storeAId));
    assert(rin003.items.length === 4, "Rincian UJI-003: 4 baris (union jadwal ∪ hadir)", {
      got: rin003.items.length,
    });
    const d4 = rin003.items.find((i) => i.tanggal === fmtTgl(6));
    assert(
      d4?.status === "IZIN" && (d4?.alasanIzin ?? "").includes("P2c"),
      "Rincian UJI-003 D4: IZIN + alasan",
      d4
    );
    assert(
      !rin003.items.some((i) => i.tanggal === fmtTgl(7)),
      "Rincian UJI-003: izin off-day D5 tidak tampil"
    );
    assert(
      rin003.ringkasan.hariHadir === 2 &&
        rin003.ringkasan.hariIzin === 1 &&
        rin003.ringkasan.hariTanpaKeterangan === 1 &&
        rin003.ringkasan.hariDiLuarJadwal === 0,
      "Rincian UJI-003 ringkasan: hadir 2, izin 1, tanpa-ket 1, luar 0",
      rin003.ringkasan
    );
    const agg003 = carik(repA!.karyawan, "UJI-003");
    assert(
      agg003?.jadwalHari === rin003.ringkasan.jadwalHari &&
        agg003?.hariHadir === rin003.ringkasan.hariHadir &&
        agg003?.hariIzin === rin003.ringkasan.hariIzin &&
        agg003?.hariTanpaKeterangan === rin003.ringkasan.hariTanpaKeterangan &&
        agg003?.hariDiLuarJadwal === rin003.ringkasan.hariDiLuarJadwal,
      "Invarian UJI-003 @A: rincian == agregat",
      { agg: agg003, rin: rin003.ringkasan }
    );

    // UJI-002 lensa A: D3 (tgl 5) HADIR via PAM, fisik = toko B.
    const rin002 = await getRincianKehadiran(rinArgs(uji002.id, storeAId));
    const pamDay = rin002.items.find((i) => i.tanggal === fmtTgl(5));
    assert(
      pamDay?.status === "HADIR" &&
        pamDay?.isPam === true &&
        pamDay?.storeFisikNama === storeB.nama,
      "Rincian UJI-002 D3: HADIR + isPam + fisik toko B",
      pamDay
    );

    // UJI-004 lensa A: D1 HADIR walau ada izin (hadir menang, alasan null).
    const rin004A = await getRincianKehadiran(rinArgs(uji004.id, storeAId));
    const d1A = rin004A.items.find((i) => i.tanggal === fmtTgl(3));
    assert(
      d1A?.status === "HADIR" && d1A?.alasanIzin === null,
      "Rincian UJI-004 D1 @A: HADIR, alasan null (hadir menang)",
      d1A
    );

    // UJI-004 lensa B: 2 baris DILUAR_JADWAL + invarian vs agregat B.
    const rin004B = await getRincianKehadiran(rinArgs(uji004.id, storeBId));
    assert(
      rin004B.items.length === 2 && rin004B.ringkasan.hariDiLuarJadwal === 2,
      "Rincian UJI-004 @B: 2 baris DILUAR_JADWAL",
      rin004B.ringkasan
    );
    const agg004B = carik(repB!.karyawan, "UJI-004");
    assert(
      agg004B?.jadwalHari === rin004B.ringkasan.jadwalHari &&
        agg004B?.hariHadir === rin004B.ringkasan.hariHadir &&
        agg004B?.hariIzin === rin004B.ringkasan.hariIzin &&
        agg004B?.hariTanpaKeterangan === rin004B.ringkasan.hariTanpaKeterangan &&
        agg004B?.hariDiLuarJadwal === rin004B.ringkasan.hariDiLuarJadwal,
      "Invarian UJI-004 @B: rincian == agregat",
      { agg: agg004B, rin: rin004B.ringkasan }
    );

    // UJI-001 @A (hadir penuh) dan UJI-005 @A (kosong).
    const rin001 = await getRincianKehadiran(rinArgs(uji001.id, storeAId));
    const agg001 = carik(repA!.karyawan, "UJI-001");
    assert(
      rin001.items.length === 2 && rin001.ringkasan.hariHadir === 2,
      "Rincian UJI-001: 2 baris HADIR",
      rin001.ringkasan
    );
    assert(
      agg001?.hariTanpaKeterangan === rin001.ringkasan.hariTanpaKeterangan &&
        agg001?.hariDiLuarJadwal === rin001.ringkasan.hariDiLuarJadwal,
      "Invarian UJI-001 @A: rincian == agregat",
      { agg: agg001, rin: rin001.ringkasan }
    );
    const rin005 = await getRincianKehadiran(rinArgs(uji005.id, storeAId));
    assert(rin005.items.length === 0, "Rincian UJI-005: 0 baris", {
      got: rin005.items.length,
    });
  } catch (err) {
    failed += 1;
    console.error("❌ Gagal menjalankan skenario:", err);
  } finally {
    // ---------- Cleanup (residu 0) ----------
    console.log("\n[4] Cleanup");
    try {
      await prisma.attendance.deleteMany({ where: { employeeId: { in: anggotaIds } } });
      await prisma.izin.deleteMany({ where: { employeeId: { in: anggotaIds } } });
      await prisma.shiftAssignment.deleteMany({ where: { shiftInstance: { storeId: { in: [storeAId, storeBId] } } } });
      await prisma.shiftInstance.deleteMany({ where: { storeId: { in: [storeAId, storeBId] } } });
      await prisma.shiftTemplate.deleteMany({ where: { storeId: { in: [storeAId, storeBId] } } });
      await prisma.user.deleteMany({ where: { id: { in: anggotaIds } } });
      await prisma.store.deleteMany({ where: { id: { in: [storeAId, storeBId] } } });
    } catch (err) {
      failed += 1;
      console.error("❌ Cleanup error:", err);
    }

    const residu =
      (await prisma.user.count({ where: { id: { in: anggotaIds } } })) +
      (await prisma.store.count({ where: { id: { in: [storeAId, storeBId] } } })) +
      (await prisma.attendance.count({ where: { employeeId: { in: anggotaIds } } })) +
      (await prisma.izin.count({ where: { employeeId: { in: anggotaIds } } })) +
      (await prisma.shiftAssignment.count({ where: { shiftInstance: { storeId: { in: [storeAId, storeBId] } } } })) +
      (await prisma.shiftInstance.count({ where: { storeId: { in: [storeAId, storeBId] } } }));
    assert(residu === 0, `residu data uji = 0`, { residu });

    await prisma.$disconnect();
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exit(1);
}

main();
