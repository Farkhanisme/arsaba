import { PrismaClient, Role, StatusKaryawan, TipePerhitunganGaji } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// --- Data seed -------------------------------------------------------------
// 3 toko awal dari §4.1 SPESIFIKASI_SISTEM (bukan hardcode produksi — nilai
// awal yang memang wajib di-seed; selanjutnya dikelola lewat UI master toko).
const TOKO_SEED = [
  "Arsaba Induk", "Arsaba Mart", "Al Madad", "Beras Wangi",
  "Mie Ayam", "Temanggung", "BGM Dieng", "Counter Dieng",
  "Sambel Bakar", "Dapur Produksi"
] as const;

type Pii = {
  nik?: string;
  tempatLahir?: string;
  tanggalLahir?: Date;
  alamat?: string;
  kontakDarurat?: string;
};

type SeedUser = {
  kode: string;
  nama: string;
  role: Role;
  toko?: (typeof TOKO_SEED)[number];
  tipe?: TipePerhitunganGaji;
  tarifPerJam?: number;
  tarifPerHari?: number;
  gajiPokok?: number;
  /** Kosongkan (= profil belum lengkap, sesuai AGENTS) untuk sebagian karyawan. */
  pii?: Pii;
};

const LENGKAP_A: Pii = {
  nik: "3401010101900001",
  tempatLahir: "Sleman",
  tanggalLahir: new Date("1990-01-01T00:00:00+07:00"),
  alamat: "Jl. Magelang KM 5, Sleman",
  kontakDarurat: "0812-3456-7890",
};
const LENGKAP_B: Pii = {
  nik: "3401010202920002",
  tempatLahir: "Yogyakarta",
  tanggalLahir: new Date("1992-02-02T00:00:00+07:00"),
  alamat: "Jl. Kaliurang KM 7, Sleman",
  kontakDarurat: "0813-9876-5432",
};
const LENGKAP_C: Pii = {
  nik: "3401010303930003",
  tempatLahir: "Magelang",
  tanggalLahir: new Date("1993-03-03T00:00:00+07:00"),
  alamat: "Jl. Solo KM 3, Yogyakarta",
  kontakDarurat: "0857-1111-2222",
};
const LENGKAP_D: Pii = {
  nik: "3401010404940004",
  tempatLahir: "Bantul",
  tanggalLahir: new Date("1994-04-04T00:00:00+07:00"),
  alamat: "Jl. Imogiri KM 2, Bantul",
  kontakDarurat: "0819-3333-4444",
};
// Sengaja parsial → demo indikator "profil belum lengkap".
const PARSIAL: Pii = {
  nik: "3401010505950005",
  alamat: "Jl. Parangtritis KM 4, Bantul",
};

const USERS: SeedUser[] = [
  { kode: "DIR-001", nama: "Direktur Arsaba", role: Role.DIREKTUR },
  { kode: "MGR-001", nama: "Manajer Arsaba", role: Role.MANAJER },
  { kode: "EMP-001", nama: "Admin Arsaba", role: Role.ADMIN },
  { kode: "EMP-002", nama: "Supervisor Arsaba", role: Role.SUPERVISOR },
  // Arsaba Induk: 1 kepala toko + 2 karyawan
  { kode: "EMP-003", nama: "Agus Wijaya", role: Role.KEPALA_TOKO, toko: "Arsaba Induk", tipe: TipePerhitunganGaji.BULANAN, gajiPokok: 3500000, pii: LENGKAP_A },
  { kode: "EMP-004", nama: "Dewi Lestari", role: Role.KARYAWAN, toko: "Arsaba Induk", tipe: TipePerhitunganGaji.HARIAN, tarifPerHari: 120000 },
  { kode: "EMP-005", nama: "Rina Marlina", role: Role.KARYAWAN, toko: "Arsaba Induk", tipe: TipePerhitunganGaji.BULANAN, gajiPokok: 2500000, pii: PARSIAL },
  // Arsaba Mart: 1 kepala toko + 2 karyawan
  { kode: "EMP-006", nama: "Bambang Sutrisno", role: Role.KEPALA_TOKO, toko: "Arsaba Mart", tipe: TipePerhitunganGaji.BULANAN, gajiPokok: 3500000, pii: LENGKAP_B },
  { kode: "EMP-007", nama: "Sari Puspita", role: Role.KARYAWAN, toko: "Arsaba Mart", tipe: TipePerhitunganGaji.HARIAN, tarifPerHari: 120000 },
  { kode: "EMP-008", nama: "Andi Prasetyo", role: Role.KARYAWAN, toko: "Arsaba Mart", tipe: TipePerhitunganGaji.HARIAN, tarifPerHari: 140000, pii: LENGKAP_C },
  // BGM Dieng: 1 kepala toko + 2 karyawan
  { kode: "EMP-009", nama: "Hendra Gunawan", role: Role.KEPALA_TOKO, toko: "BGM Dieng", tipe: TipePerhitunganGaji.BULANAN, gajiPokok: 3500000 },
  { kode: "EMP-010", nama: "Putri Ayu", role: Role.KARYAWAN, toko: "BGM Dieng", tipe: TipePerhitunganGaji.BULANAN, gajiPokok: 2750000, pii: LENGKAP_D },
  { kode: "EMP-011", nama: "Fajar Nugroho", role: Role.KARYAWAN, toko: "BGM Dieng", tipe: TipePerhitunganGaji.HARIAN, tarifPerHari: 120000 },
];

// --- Main ------------------------------------------------------------------

async function main() {
  // SEED_PASSWORD didahulukan; SEED_ADMIN_PASSWORD dipertahankan sebagai fallback
  // agar deployment lama tidak rusak.
  const plainPassword = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!plainPassword) {
    console.error("SEED_PASSWORD (atau SEED_ADMIN_PASSWORD) belum diset di .env. Set dulu sebelum menjalankan seed.");
    process.exit(1);
  }
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  // 1. Toko (idempoten: cari by nama, buat bila belum ada).
  const storeIds = new Map<string, string>();
  for (const nama of TOKO_SEED) {
    const found = await prisma.store.findFirst({ where: { nama } });
    const store = found ?? (await prisma.store.create({ data: { nama } }));
    storeIds.set(nama, store.id);
    console.log(`${found ? "Toko sudah ada" : "Toko dibuat "} : ${nama}`);
  }

  // 2. User semua role (idempoten: upsert per kode).
  for (const u of USERS) {
    const storeId = u.toko ? storeIds.get(u.toko)! : null;
    const created = await prisma.user.upsert({
      where: { kode: u.kode },
      create: {
        kode: u.kode,
        nama: u.nama,
        hashedPassword,
        role: u.role,
        status: StatusKaryawan.AKTIF,
        storeId,
        tipePerhitunganGaji: u.tipe ?? null,
        tarifPerJam: u.tarifPerJam ?? null,
        tarifPerHari: u.tarifPerHari ?? null,
        tanggalMasuk: u.toko ? new Date("2026-01-05T00:00:00+07:00") : null,
        ...(u.pii ?? {}),
      },
      update: {
        nama: u.nama,
        hashedPassword,
        role: u.role,
        status: StatusKaryawan.AKTIF,
        storeId,
        tipePerhitunganGaji: u.tipe ?? null,
        tarifPerJam: u.tarifPerJam ?? null,
        tarifPerHari: u.tarifPerHari ?? null,
        ...(u.pii ?? {}),
      },
    });

    // 3. Penempatan (guard: jangan dobel saat seed dijalankan ulang).
    if (u.toko) {
      const sudahAda = await prisma.riwayatPenempatan.findFirst({
        where: { employeeId: created.id, keTokoId: storeId! },
      });
      if (!sudahAda) {
        await prisma.riwayatPenempatan.create({
          data: {
            employeeId: created.id,
            dariTokoId: null,
            keTokoId: storeId!,
            alasan: "Penempatan awal (seed)",
          },
        });
      }
    }

    // 4. Gaji pokok (upsert per employee).
    if (u.gajiPokok != null) {
      await prisma.gajiPokok.upsert({
        where: { employeeId: created.id },
        create: { employeeId: created.id, nominal: u.gajiPokok },
        update: { nominal: u.gajiPokok },
      });
    }
  }

  // 5. Sinkron kodeCounter selaras logika API (DIR/MGR/EMP + padStart 3).
  //    Ambil max(nomor di seed, counter lama) agar tidak menimpa counter
  //    produksi yang sudah lebih besar.
  const prefixMax = new Map<string, number>();
  for (const u of USERS) {
    const [prefix = "", num = "0"] = u.kode.split("-");
    prefixMax.set(prefix, Math.max(prefixMax.get(prefix) ?? 0, Number(num)));
  }
  for (const [prefix, min] of prefixMax) {
    const cur = await prisma.kodeCounter.findUnique({ where: { prefix } });
    const next = Math.max(cur?.lastNumber ?? 0, min);
    await prisma.kodeCounter.upsert({
      where: { prefix },
      create: { prefix, lastNumber: next },
      update: { lastNumber: next },
    });
  }

  // 6. Seed ShiftTemplate untuk semua 10 toko (sesuai §4.1 spec).
  //    Template ini adalah master shift yang akan dipakai generate ShiftInstance.
  const SHIFT_TEMPLATE_SEED = [
    // Arsaba Induk: Pagi 06:30-16:30, Siang 11:00-21:00
    { store: "Arsaba Induk", nama: "Pagi", jamMulaiMenit: 390, jamSelesaiMenit: 990, lintasHari: false, hariKerja: [] },
    { store: "Arsaba Induk", nama: "Siang", jamMulaiMenit: 660, jamSelesaiMenit: 1260, lintasHari: false, hariKerja: [] },
    // Arsaba Mart: Pagi 05:30-17:30, Tengah 10:00-20:00, Siang 13:00-24:00, 24 Jam 18:00-06:00 (lintas)
    { store: "Arsaba Mart", nama: "Pagi", jamMulaiMenit: 330, jamSelesaiMenit: 1050, lintasHari: false, hariKerja: [] },
    { store: "Arsaba Mart", nama: "Tengah", jamMulaiMenit: 600, jamSelesaiMenit: 1200, lintasHari: false, hariKerja: [] },
    { store: "Arsaba Mart", nama: "Siang", jamMulaiMenit: 780, jamSelesaiMenit: 1440, lintasHari: false, hariKerja: [] },
    { store: "Arsaba Mart", nama: "24 Jam", jamMulaiMenit: 1080, jamSelesaiMenit: 360, lintasHari: true, hariKerja: [] },
    // Al Madad: Pagi 06:00-16:00, Siang 10:00-20:00
    { store: "Al Madad", nama: "Pagi", jamMulaiMenit: 360, jamSelesaiMenit: 960, lintasHari: false, hariKerja: [] },
    { store: "Al Madad", nama: "Siang", jamMulaiMenit: 600, jamSelesaiMenit: 1200, lintasHari: false, hariKerja: [] },
    // Beras Wangi: Pagi 06:00-17:00
    { store: "Beras Wangi", nama: "Pagi", jamMulaiMenit: 360, jamSelesaiMenit: 1020, lintasHari: false, hariKerja: [] },
    // Mie Ayam: Pagi 07:15-17:15, Siang 10:00-20:00
    { store: "Mie Ayam", nama: "Pagi", jamMulaiMenit: 435, jamSelesaiMenit: 1035, lintasHari: false, hariKerja: [] },
    { store: "Mie Ayam", nama: "Siang", jamMulaiMenit: 600, jamSelesaiMenit: 1200, lintasHari: false, hariKerja: [] },
    // Temanggung: Pagi 05:30-13:00, Sore 17:00-21:30
    { store: "Temanggung", nama: "Pagi", jamMulaiMenit: 330, jamSelesaiMenit: 780, lintasHari: false, hariKerja: [] },
    { store: "Temanggung", nama: "Sore", jamMulaiMenit: 1020, jamSelesaiMenit: 1290, lintasHari: false, hariKerja: [] },
    // BGM Dieng: Weekday (Senin-Jumat): Pagi 07:00-17:00, Siang 14:00-02:00 (lintas)
    //               Weekend (Sabtu-Minggu): Pagi 07:00-19:00, Siang 14:00-02:00 (lintas), Malam 19:00-07:00 (lintas)
    { store: "BGM Dieng", nama: "Pagi Weekday", jamMulaiMenit: 420, jamSelesaiMenit: 1020, lintasHari: false, hariKerja: [1, 2, 3, 4, 5] },
    { store: "BGM Dieng", nama: "Siang Weekday", jamMulaiMenit: 840, jamSelesaiMenit: 120, lintasHari: true, hariKerja: [1, 2, 3, 4, 5] },
    { store: "BGM Dieng", nama: "Pagi Weekend", jamMulaiMenit: 420, jamSelesaiMenit: 1140, lintasHari: false, hariKerja: [0, 6] },
    { store: "BGM Dieng", nama: "Siang Weekend", jamMulaiMenit: 840, jamSelesaiMenit: 120, lintasHari: true, hariKerja: [0, 6] },
    { store: "BGM Dieng", nama: "Malam Weekend", jamMulaiMenit: 1140, jamSelesaiMenit: 420, lintasHari: true, hariKerja: [0, 6] },
    // Counter Dieng: Pagi 07:00-17:00, Sore 14:00-24:00, Malam 16:00-02:00 (lintas, overlap sengaja)
    { store: "Counter Dieng", nama: "Pagi", jamMulaiMenit: 420, jamSelesaiMenit: 1020, lintasHari: false, hariKerja: [] },
    { store: "Counter Dieng", nama: "Sore", jamMulaiMenit: 840, jamSelesaiMenit: 1440, lintasHari: false, hariKerja: [] },
    { store: "Counter Dieng", nama: "Malam", jamMulaiMenit: 960, jamSelesaiMenit: 120, lintasHari: true, hariKerja: [] },
    // Sambel Bakar: Pagi 09:00-19:00 (kepala toko fleksibel, tidak terikat shift baku)
    { store: "Sambel Bakar", nama: "Pagi", jamMulaiMenit: 540, jamSelesaiMenit: 1140, lintasHari: false, hariKerja: [] },
    // Dapur Produksi: tidak ada shift tetap — ad-hoc (template kosong/aktif=false sebagai penanda)
    { store: "Dapur Produksi", nama: "Ad-hoc", jamMulaiMenit: 0, jamSelesaiMenit: 0, lintasHari: false, hariKerja: [], aktif: false },
  ];

  for (const t of SHIFT_TEMPLATE_SEED) {
    const store = await prisma.store.findFirst({ where: { nama: t.store } });
    if (!store) {
      console.log(`  Template dilewati: toko ${t.store} belum ada`);
      continue;
    }
    const found = await prisma.shiftTemplate.findFirst({
      where: { storeId: store.id, nama: t.nama },
    });
    if (!found) {
      await prisma.shiftTemplate.create({
        data: {
          storeId: store.id,
          nama: t.nama,
          jamMulaiMenit: t.jamMulaiMenit,
          jamSelesaiMenit: t.jamSelesaiMenit,
          lintasHari: t.lintasHari,
          hariKerja: t.hariKerja ?? [],
          aktif: t.aktif ?? true,
        },
      });
      console.log(`  Template dibuat: ${store.nama} / ${t.nama}`);
    } else {
      console.log(`  Template sudah ada: ${store.nama} / ${t.nama}`);
    }
  }

  // 7. Cetak daftar akun.
  console.log("\nSeed selesai. Daftar akun demo (password sama untuk semua):");
  console.log(`  Password : ${plainPassword} (WAJIB DIGANTI setelah login pertama)`);
  for (const u of USERS) {
    console.log(
      `  ${u.kode.padEnd(8)} ${u.role.padEnd(11)} ${(u.toko ?? "-").padEnd(13)} ${u.nama}`
    );
  }
}

main()
  .catch((e) => {
    console.error("Seed gagal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
