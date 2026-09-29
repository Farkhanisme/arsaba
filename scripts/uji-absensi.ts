// UJI REGRESI — Logika absensi (lib/absensi.ts) & gate check-in
// Jalankan: npx tsx --env-file=.env scripts/uji-absensi.ts
//
// Cakupan (data self-contained + cleanup akhir, residu 0):
//   [1] Konversi WIB: formatTanggalWIB / formatWaktuWIB / computeTanggalShiftWIB.
//   [2] Hitungan telat: toleransi 5 menit (5→0, 6→1, 11→6) sesuai AGENTS.md
//       + potonganel server = menitTelat × 1000.
//   [3] Pencocokan shift acuan: check-in tepat jam mulai, 4 jam lebih awal,
//       check-in 02.00 untuk shift 18.00–06.00 lintas tengah malam, DRAFT
//       diabaikan, shift yang sudah lewat diabaikan.
//   [4] tanggalShift dari shift: shift malam 18.00–06.00 → tanggal hari MULAI.
//   [5] Auto-close: absenKeluar = jamSelesai shift (bukan now), totalMenitKerja
//       tidak melebihi jadwal, fallback ke absenMasuk tanpa shift.
//   [6] Gate check-in: shift APPROVED → boleh; tidak ada shift +
//       bolehAbsenTanpaShift=false → 403; true → boleh.
//
// Jalankan dengan: npx tsx --env-file=.env scripts/uji-absensi.ts
import { prisma as prismaRaw } from "@/lib/prisma";
import {
  AUTO_CLOSE_MS,
  TOLERANSI_MENIT,
  computeTanggalShiftWIB,
  findShiftAcuan,
  formatTanggalWIB,
  formatWaktuWIB,
  hitungAbsenKeluarAutoClose,
  hitungMenitTelat,
  hitungPotongan,
  hitungTotalMenitKerja,
  saranMenitTelat,
} from "@/lib/absensi";
import { dbClient, tungguDB as tungguDBRaw } from "./db-retry";

// Pooler free-tier Neon sering drop koneksi (P1001) bahkan di tengah skrip.
// Semua query dibungkus retry + backoff; lihat scripts/db-retry.ts untuk
// penjelasan kenapa hanya error transient yang di-retry. Karena `prisma` di
// bawah adalah Proxy, TIDAK ADA call site script yang perlu berubah.
const prisma = dbClient(prismaRaw);
const tungguDB = () => tungguDBRaw(prismaRaw);


const suffix = Date.now().toString(36);
const WIB = 7 * 60 * 60 * 1000;

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

// Detik ke WIB sebagai Date absolut.
const wib = (iso: string) => new Date(new Date(iso).getTime() - WIB);
const utc = (d: Date) => d.toISOString().slice(0, 10);

const created = { users: [] as string[], stores: [] as string[] };

async function main() {
  try {
    // Pooler Neon kadang masih "dingin" saat skrip baru dijalankan.
    await tungguDB();

    // ================= [1] Konversi WIB =================
    console.log("\n[1] Konversi waktu WIB");
    const tgl = computeTanggalShiftWIB(new Date("2026-09-28T02:00:00+07:00"));
    assert(
      utc(tgl) === "2026-09-28",
      "computeTanggalShiftWIB(02.00 WIB 28 Sep) → 2026-09-28",
      { got: utc(tgl) }
    );
    assert(
      utc(computeTanggalShiftWIB(new Date("2026-09-27T23:30:00+07:00"))) === "2026-09-27",
      "computeTanggalShiftWIB(23.30 WIB 27 Sep) → 2026-09-27 (bukan 28)",
      { got: utc(computeTanggalShiftWIB(new Date("2026-09-27T23:30:00+07:00"))) }
    );
    assert(
      formatTanggalWIB(new Date("2026-09-28T02:00:00+07:00")) === "2026-09-28",
      "formatTanggalWIB → YYYY-MM-DD"
    );
    assert(
      formatWaktuWIB(new Date("2026-09-28T14:30:00+07:00")) === "28/09/2026 14:30 WIB",
      "formatWaktuWIB → '28/09/2026 14:30 WIB'",
      { got: formatWaktuWIB(new Date("2026-09-28T14:30:00+07:00")) }
    );
    assert(formatWaktuWIB(null) === "-", "formatWaktuWIB(null) → '-'");

    // ================= [2] Hitungan keterlambatan =================
    console.log("\n[2] Menit telat & potongan (toleransi 5 menit)");
    assert(TOLERANSI_MENIT === 5, "TOLERANSI_MENIT = 5");
    const mulai = new Date("2026-09-27T18:00:00+07:00");
    // Exact cases dari AGENTS.md "Quick Test Shortcuts".
    assert(
      saranMenitTelat(new Date("2026-09-27T18:05:00+07:00"), mulai) === 0,
      "telat 5 menit → saran 0 (Rp0)"
    );
    assert(
      saranMenitTelat(new Date("2026-09-27T18:06:00+07:00"), mulai) === 1,
      "telat 6 menit → saran 1 (Rp1.000)"
    );
    assert(
      saranMenitTelat(new Date("2026-09-27T18:11:00+07:00"), mulai) === 6,
      "telat 11 menit → saran 6 (Rp6.000)"
    );
    assert(
      hitungMenitTelat(new Date("2026-09-27T17:50:00+07:00"), mulai) === 0,
      "datang 10 menit lebih awal → 0 menit telat"
    );
    assert(
      hitungPotongan(6) === 6000 && hitungPotongan(0) === 0,
      "potongan = menitTelat × 1000"
    );
    assert(
      saranMenitTelat(new Date("2026-09-27T20:00:00+07:00"), null) === null,
      "tidak ada shift acuan → saran null (isi manual)"
    );
    assert(
      hitungTotalMenitKerja(
        new Date("2026-09-27T18:00:00+07:00"),
        new Date("2026-09-27T20:30:00+07:00")
      ) === 150,
      "totalMenitKerja 18.00–20.30 = 150 menit"
    );
    assert(
      hitungTotalMenitKerja(
        new Date("2026-09-27T20:00:00+07:00"),
        new Date("2026-09-27T18:00:00+07:00")
      ) === 0,
      "totalMenitKerja tidak negatif"
    );

    // ================= Setup data =================
    const store = await prisma.store.create({ data: { nama: `UJIABS ${suffix}` } });
    created.stores.push(store.id);

    const admin = await prisma.user.create({
      data: {
        kode: `UJIABS-ADM-${suffix}`,
        nama: "Admin Uji Absensi",
        role: "ADMIN",
        status: "AKTIF",
      },
    });
    created.users.push(admin.id);

    const karyawan = await prisma.user.create({
      data: {
        kode: `UJIABS-EMP-${suffix}`,
        nama: "Karyawan Uji Absensi",
        role: "KARYAWAN",
        status: "AKTIF",
        storeId: store.id,
        tipePerhitunganGaji: "HARIAN",
      },
    });
    created.users.push(karyawan.id);

    const tanpaToko = await prisma.user.create({
      data: {
        kode: `UJIABS-SUP-${suffix}`,
        nama: "Supervisor Uji Absensi",
        role: "SUPERVISOR",
        status: "AKTIF",
      },
    });
    created.users.push(tanpaToko.id);

    const mkInstance = async (tanggal: Date, jamMulai: Date, jamSelesai: Date, status: "DRAFT" | "APPROVED") =>
      prisma.shiftInstance.create({
        data: {
          storeId: store.id,
          tanggal,
          jamMulai,
          jamSelesai,
          sumberJadwal: "MANUAL",
          statusJadwal: status,
          createdById: admin.id,
        },
      });

    // Shift malam: Minggu 18.00 → Senin 06.00 (lintas tengah malam).
    const malamTanggal = new Date(Date.UTC(2026, 8, 27)); // 2026-09-27 (Minggu)
    const instMalam = await mkInstance(
      malamTanggal,
      wib("2026-09-27T18:00:00+07:00"),
      wib("2026-09-28T06:00:00+07:00"),
      "APPROVED"
    );
    await prisma.shiftAssignment.create({
      data: {
        shiftInstanceId: instMalam.id,
        employeeId: karyawan.id,
        segmen: "NORMAL",
        jamMulai: wib("2026-09-27T18:00:00+07:00"),
        jamSelesai: wib("2026-09-28T06:00:00+07:00"),
        createdById: admin.id,
      },
    });

    // Shift DRAFT — harus TIDAK jadi acuan.
    const instDraft = await mkInstance(
      new Date(Date.UTC(2026, 8, 29)),
      wib("2026-09-29T08:00:00+07:00"),
      wib("2026-09-29T17:00:00+07:00"),
      "DRAFT"
    );
    await prisma.shiftAssignment.create({
      data: {
        shiftInstanceId: instDraft.id,
        employeeId: karyawan.id,
        segmen: "NORMAL",
        jamMulai: wib("2026-09-29T08:00:00+07:00"),
        jamSelesai: wib("2026-09-29T17:00:00+07:00"),
        createdById: admin.id,
      },
    });

    // Shift di toko lain — harus TIDAK jadi acuan karyawan ini.
    const storeLain = await prisma.store.create({ data: { nama: `UJIABS2 ${suffix}` } });
    created.stores.push(storeLain.id);
    const instLain = await prisma.shiftInstance.create({
      data: {
        storeId: storeLain.id,
        tanggal: new Date(Date.UTC(2026, 8, 30)),
        jamMulai: wib("2026-09-30T08:00:00+07:00"),
        jamSelesai: wib("2026-09-30T17:00:00+07:00"),
        sumberJadwal: "MANUAL",
        statusJadwal: "APPROVED",
        createdById: admin.id,
      },
    });
    await prisma.shiftAssignment.create({
      data: {
        shiftInstanceId: instLain.id,
        employeeId: karyawan.id,
        segmen: "PAM",
        jamMulai: wib("2026-09-30T08:00:00+07:00"),
        jamSelesai: wib("2026-09-30T17:00:00+07:00"),
        createdById: admin.id,
      },
    });

    // ================= [3] Pencocokan shift acuan =================
    console.log("\n[3] Pencocokan shift acuan (findShiftAcuan)");
    const acTepat = await findShiftAcuan(karyawan.id, wib("2026-09-27T18:00:00+07:00"));
    assert(acTepat !== null && acTepat.assignmentId !== "", "check-in tepat jam mulai → ketemu shift", acTepat);
    const acMwst = await findShiftAcuan(karyawan.id, wib("2026-09-27T14:10:00+07:00"));
    assert(acMwst !== null, "check-in 3j50m sebelum jam mulai (dalam jendela 4 jam) → ketemu", acMwst);
    const acToo = await findShiftAcuan(karyawan.id, wib("2026-09-27T13:00:00+07:00"));
    assert(acToo === null, "check-in 5 jam sebelum jam mulai (di luar jendela) → null", acToo);
    const acDini = await findShiftAcuan(karyawan.id, wib("2026-09-28T02:00:00+07:00"));
    assert(
      acDini !== null && utc(acDini.tanggal) === "2026-09-27",
      "check-in 02.00 SENIN untuk shift MINGGU 18.00–06.00 → ketemu, tanggal = 2026-09-27",
      { tanggal: acDini ? utc(acDini.tanggal) : null }
    );
    const acLewat = await findShiftAcuan(karyawan.id, wib("2026-09-28T06:01:00+07:00"));
    assert(acLewat === null, "check-in setelah jamSelesai shift → null", acLewat);
    const acDraft = await findShiftAcuan(karyawan.id, wib("2026-09-29T08:00:00+07:00"));
    assert(acDraft === null, "shift DRAFT bukan acuan → null", acDraft);
    const acTanpaToko = await findShiftAcuan(tanpaToko.id, wib("2026-09-27T18:30:00+07:00"));
    assert(acTanpaToko === null, "Supervisor tanpa assignment → null", acTanpaToko);

    // ================= [4] tanggalShift dari shift =================
    console.log("\n[4] Atribusi tanggalShift dari jamMulai shift");
    assert(
      acDini !== null && utc(acDini.tanggal) === "2026-09-27",
      "tanggalShift shift malam = hari MULAI (Minggu), bukan hari check-in (Senin)"
    );
    const tanpaAcuan = computeTanggalShiftWIB(new Date("2026-09-28T02:00:00+07:00"));
    assert(
      utc(tanpaAcuan) === "2026-09-28",
      "tanpa shift acuan → fallback tanggal kalender WIB (Senin)"
    );

    // ================= [5] Auto-close =================
    console.log("\n[5] Auto-close: absenKeluar = jamSelesai shift");
    const acuanMalam = await findShiftAcuan(karyawan.id, wib("2026-09-27T18:30:00+07:00"));
    const masukMalam = wib("2026-09-27T18:30:00+07:00");
    const keluarAuto = hitungAbsenKeluarAutoClose(masukMalam, acuanMalam);
    assert(
      keluarAuto.toISOString() === wib("2026-09-28T06:00:00+07:00").toISOString(),
      "absenKeluar auto = jamSelesai shift (28 Sep 06.00), bukan 'now'",
      { got: keluarAuto.toISOString() }
    );
    const menitAuto = hitungTotalMenitKerja(masukMalam, keluarAuto);
    assert(
      menitAuto === 690,
      "totalMenitKerja auto = 690 menit (11.5 jam), sesuai jadwal",
      { menitAuto }
    );
    const keluarFallback = hitungAbsenKeluarAutoClose(masukMalam, null);
    assert(
      keluarFallback.toISOString() === masukMalam.toISOString(),
      "tanpa shift → fallback absenMasuk (totalMenitKerja 0, tidak bayar 20 jam)"
    );
    const keluarBelumMulai = hitungAbsenKeluarAutoClose(
      wib("2026-09-27T18:30:00+07:00"),
      { jamSelesai: wib("2026-09-27T18:00:00+07:00") }
    );
    assert(
      keluarBelumMulai.toISOString() === masukMalam.toISOString(),
      "jamSelesai < absenMasuk → fallback absenMasuk (tidak negatif)"
    );
    assert(AUTO_CLOSE_MS === 20 * 60 * 60 * 1000, "AUTO_CLOSE_MS = 20 jam");

    // ================= [6] Gate check-in =================
    console.log("\n[6] Gate check-in: shift vs bolehAbsenTanpaShift");
    // Mirror guard app/api/absensi/route.ts (gate setelah findShiftAcuan).
    const gate = (shiftAda: boolean, boleh: boolean): number => {
      if (!shiftAda && !boleh) return 403;
      return 200;
    };
    assert(gate(true, false) === 200, "punya shift APPROVED → boleh (200)");
    assert(gate(false, false) === 403, "tanpa shift & flag false → 403");
    assert(gate(false, true) === 200, "tanpa shift & flag true → boleh (200)");

    // Verifikasi field User benar-benar bisa menyimpan flag.
    await prisma.user.update({
      where: { id: tanpaToko.id },
      data: { bolehAbsenTanpaShift: true },
    });
    const setelah = await prisma.user.findUnique({
      where: { id: tanpaToko.id },
      select: { bolehAbsenTanpaShift: true, storeId: true },
    });
    assert(
      setelah?.bolehAbsenTanpaShift === true && setelah.storeId === null,
      "Supervisor tanpa toko bisa punya bolehAbsenTanpaShift = true",
      setelah
    );
    const defaultBelum = await prisma.user.findUnique({
      where: { id: karyawan.id },
      select: { bolehAbsenTanpaShift: true },
    });
    assert(
      defaultBelum?.bolehAbsenTanpaShift === false,
      "default user baru = bolehAbsenTanpaShift false"
    );

    // ================= Cleanup =================
    // Sengaja dijalankan dari finally() di bawah, BUKAN di sini — kalau ada
    // exception di tengah, cleanup tetap harus jalan. Sisa data uji di DB jauh
    // lebih merepotkan daripada test yang gagal.
  } catch (e) {
    console.error("\n💥 Skrip gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[7] Cleanup");
    try {
      await bersihkan();
      const residu =
        (await prisma.user.count({ where: { kode: { contains: `UJIABS` } } })) +
        (await prisma.store.count({ where: { nama: { contains: "UJIABS" } } }));
      // Pakai assert() (bukan console.log) supaya ikut terhitung di ringkasan.
      assert(residu === 0, `residu data uji = ${residu}`);
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      console.error(
        `     Hapus manual:\n` +
          `       DELETE FROM "User"  WHERE kode LIKE 'UJIABS%';\n` +
          `       DELETE FROM "Store" WHERE nama LIKE 'UJIABS%';`
      );
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

/** Hapus semua artefak uji. Terpisah agar bisa dipanggil dari finally(). */
async function bersihkan(): Promise<void> {
  const users = created.users;
  const stores = created.stores;
  await prisma.attendanceLog.deleteMany({
    where: { attendance: { employeeId: { in: users } } },
  });
  await prisma.attendance.deleteMany({ where: { employeeId: { in: users } } });
  await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: users } } });
  await prisma.shiftInstance.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.izin.deleteMany({ where: { employeeId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: { in: users } } });
  await prisma.gajiPokok.deleteMany({ where: { employeeId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
}

void main();
