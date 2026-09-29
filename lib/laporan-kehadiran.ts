import { prisma } from "@/lib/prisma";

// Komputasi Laporan Kehadiran (§8 spec: "Laporan Kehadiran & Izin").
// Dipakai oleh GET /api/laporan/kehadiran dan script uji.
//
// Definisi (nilai turunan, bukan record):
// - jadwalHari    = tanggal unik ShiftAssignment pada ShiftInstance APPROVED.
// - hariHadir     = tanggalShift unik Attendance statusMasuk DIVERIFIKASI
//                   (tanpa filter toko — PAM di toko lain tetap "berangkat").
// - hariIzin      = tanggal Izin pada hari jadwal toko tsb yang TIDAK punya
//                   attendance terverifikasi (hadir menang atas izin;
//                   izin di hari tanpa jadwal tidak dihitung).
// - tanpaKeterangan = max(0, jadwal - hadir - izin).
// - diLuarJadwal  = max(0, hadir - jadwal).
//
// CATATAN: tidak ada lagi "lensa fisik" / hadirFisik. Kehadiran TIDAK terikat
// toko — `Attendance.storeId` nullable hanya untuk jejak administratif, dan
// tidak memengaruhi perhitungan kehadiran. Karyawan tanpa toko (Supervisor/
// Admin) dikelompokkan di grup "Tanpa Toko" di paling bawah.

export type LaporanKaryawan = {
  employeeId: string;
  kode: string;
  nama: string;
  status: string;
  tipePerhitunganGaji: string | null;
  jadwalHari: number;
  hariHadir: number;
  hariIzin: number;
  hariTanpaKeterangan: number;
  hariDiLuarJadwal: number;
  persentaseKehadiran: number | null;
};

export type LaporanStore = {
  storeId: string;
  storeNama: string;
  totalKaryawan: number;
  totalHariJadwal: number;
  totalHariHadir: number;
  totalHariIzin: number;
  totalHariTidakHadir: number;
  totalHariTanpaKeterangan: number;
  persentaseKehadiran: number | null;
  karyawan: LaporanKaryawan[];
};

export type LaporanKehadiran = {
  periode: string;
  daftarToko: Array<{ id: string; nama: string }>;
  stores: LaporanStore[];
};

function tanggalKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Grup sentinel untuk karyawan tanpa toko (User.storeId = null). Bukan id Store
// sungguhan — hanya pembeda di loop per-"toko" supaya Supervisor/Admin punya
// tempat tampil di laporan.
const TANPA_TOKO_ID = "__TANPA_TOKO__";
const TANPA_TOKO = { id: TANPA_TOKO_ID, nama: "Tanpa Toko" };

function isTokoTanpaToko(id: string): boolean {
  return id === TANPA_TOKO_ID;
}

// Grup "Tanpa Toko" hanya muncul kalau tidak ada filter toko tertentu.
function tokoTampilTanpaToko(tokoFilter: string | null): boolean {
  return tokoFilter === null;
}

function persen(hadir: number, jadwal: number): number | null {
  if (jadwal <= 0) return null;
  return Math.round((hadir / jadwal) * 1000) / 10;
}

export async function getLaporanKehadiran(args: {
  periode: string;
  awalBulan: Date;
  akhirBulan: Date;
  storeId?: string | null;
}): Promise<LaporanKehadiran> {
  const { periode, awalBulan, akhirBulan, storeId } = args;

  const daftarToko = await prisma.store.findMany({
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });
  const tokoFilter = storeId ?? null;
  const tokoTampil = tokoFilter
    ? daftarToko.filter((t) => t.id === tokoFilter)
    : daftarToko;

  // 1. Baseline: assignment pada instance APPROVED (lensa penugasan).
  const baselineRows = await prisma.shiftAssignment.findMany({
    where: {
      shiftInstance: {
        tanggal: { gte: awalBulan, lt: akhirBulan },
        statusJadwal: "APPROVED",
        ...(tokoFilter ? { storeId: tokoFilter } : {}),
      },
    },
    select: {
      employeeId: true,
      shiftInstance: { select: { storeId: true, tanggal: true } },
    },
  });

  // 2. Kehadiran terverifikasi: 1 baris = 1 (employee, tanggal) unik.
  //    Sengaja tanpa filter storeId — kehadiran tidak terikat toko.
  const hadirRows = await prisma.attendance.groupBy({
    by: ["employeeId", "tanggalShift"],
    where: {
      tanggalShift: { gte: awalBulan, lt: akhirBulan },
      statusMasuk: "DIVERIFIKASI",
    },
    _count: { id: true },
  });

  // 3. Izin pada bulan berjalan.
  const izinRows = await prisma.izin.findMany({
    where: { tanggal: { gte: awalBulan, lt: akhirBulan } },
    select: { employeeId: true, tanggal: true },
  });

  // Collapse ke Set tanggal per employee.
  const jadwalMap = new Map<string, Map<string, Set<string>>>(); // storeId -> employeeId -> Set<tanggal>
  for (const r of baselineRows) {
    const sid = r.shiftInstance.storeId;
    let byEmp = jadwalMap.get(sid);
    if (!byEmp) {
      byEmp = new Map();
      jadwalMap.set(sid, byEmp);
    }
    let set = byEmp.get(r.employeeId);
    if (!set) {
      set = new Set();
      byEmp.set(r.employeeId, set);
    }
    set.add(tanggalKey(r.shiftInstance.tanggal));
  }

  const hadirMap = new Map<string, Set<string>>();
  for (const r of hadirRows) {
    let set = hadirMap.get(r.employeeId);
    if (!set) {
      set = new Set();
      hadirMap.set(r.employeeId, set);
    }
    set.add(tanggalKey(r.tanggalShift));
  }

  const izinMap = new Map<string, Set<string>>();
  for (const r of izinRows) {
    let set = izinMap.get(r.employeeId);
    if (!set) {
      set = new Set();
      izinMap.set(r.employeeId, set);
    }
    set.add(tanggalKey(r.tanggal));
  }

  // 5. Karyawan: gabungan baseline + terdaftar AKTIF di toko tampil.
  const storeIds = tokoTampil.map((t) => t.id);
  const baselineIds = new Set<string>();
  for (const byEmp of jadwalMap.values()) {
    for (const eid of byEmp.keys()) baselineIds.add(eid);
  }
  // Karyawan tanpa toko (Supervisor/Admin, `User.storeId` null) ikut diambil
  // supaya mereka bisa tampil di grup "Tanpa Toko".
  const tanpaToko = tokoTampilTanpaToko(tokoFilter)
    ? await prisma.user.findMany({
        where: { storeId: null, status: "AKTIF" },
        select: { id: true },
      })
    : [];
  const terdaftar =
    storeIds.length > 0
      ? await prisma.user.findMany({
          where: { storeId: { in: storeIds }, status: "AKTIF" },
          select: { id: true },
        })
      : [];
  const needIds = new Set<string>([
    ...baselineIds,
    ...terdaftar.map((u) => u.id),
    ...tanpaToko.map((u) => u.id),
  ]);
  const users =
    needIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...needIds] } },
          select: {
            id: true,
            kode: true,
            nama: true,
            status: true,
            tipePerhitunganGaji: true,
            storeId: true,
          },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 6. Bangun payload per toko + grup "Tanpa Toko" di paling bawah.
  const stores: LaporanStore[] = [];
  for (const toko of [...tokoTampil, ...(tokoTampilTanpaToko(tokoFilter) ? [TANPA_TOKO] : [])]) {
    const byEmpJadwal = jadwalMap.get(toko.id) ?? new Map<string, Set<string>>();
    const ids = new Set<string>([...byEmpJadwal.keys()]);
    for (const u of users) {
      if (u.status !== "AKTIF") continue;
      if (isTokoTanpaToko(toko.id) ? u.storeId === null : u.storeId === toko.id) {
        ids.add(u.id);
      }
    }

    const karyawan: LaporanKaryawan[] = [];
    for (const eid of ids) {
      const u = userMap.get(eid);
      if (!u) continue;
      const jadwalSet = byEmpJadwal.get(eid);
      const jadwalHari = jadwalSet?.size ?? 0;
      const hadirSet = hadirMap.get(eid) ?? new Set<string>();
      const hariHadir = hadirSet.size;
      const izinSet = izinMap.get(eid) ?? new Set<string>();
      let hariIzin = 0;
      for (const t of izinSet) {
        // Hanya di hari jadwal toko tsb yang tidak dihadiri (hadir menang, off-day tidak dihitung).
        if (jadwalSet?.has(t) && !hadirSet.has(t)) hariIzin += 1;
      }
      const hariTanpaKeterangan = Math.max(0, jadwalHari - hariHadir - hariIzin);
      const hariDiLuarJadwal = Math.max(0, hariHadir - jadwalHari);

      karyawan.push({
        employeeId: eid,
        kode: u.kode,
        nama: u.nama,
        status: u.status,
        tipePerhitunganGaji: u.tipePerhitunganGaji,
        jadwalHari,
        hariHadir,
        hariIzin,
        hariTanpaKeterangan,
        hariDiLuarJadwal,
        persentaseKehadiran: persen(hariHadir, jadwalHari),
      });
    }
    karyawan.sort((a, b) => a.kode.localeCompare(b.kode));

    const sum = (f: (k: LaporanKaryawan) => number) =>
      karyawan.reduce((s, k) => s + f(k), 0);
    const totalHariJadwal = sum((k) => k.jadwalHari);
    const totalHariHadir = sum((k) => k.hariHadir);
    const totalHariIzin = sum((k) => k.hariIzin);
    const totalHariTidakHadir = Math.max(0, totalHariJadwal - totalHariHadir);
    const totalHariTanpaKeterangan = Math.max(
      0,
      totalHariTidakHadir - totalHariIzin
    );

    stores.push({
      storeId: toko.id,
      storeNama: toko.nama,
      totalKaryawan: karyawan.length,
      totalHariJadwal,
      totalHariHadir,
      totalHariIzin,
      totalHariTidakHadir,
      totalHariTanpaKeterangan,
      persentaseKehadiran: persen(totalHariHadir, totalHariJadwal),
      karyawan,
    });
  }

  return {
    periode,
    daftarToko: daftarToko.map((t) => ({ id: t.id, nama: t.nama })),
    stores,
  };
}

// ============ RINCIAN PER TANGGAL (Scope B.1) ============
// Lensa per hari untuk satu karyawan pada satu bulan. Aturan status per tanggal
// (konsisten dengan agregat di atas):
// - HADIR: ada attendance DIVERIFIKASI (hadir menang atas izin & jadwal).
// - DILUAR_JADWAL: hadir tapi tanggal tsb bukan hari jadwal lensa ini.
// - IZIN: tidak hadir + tanggal tsb hari jadwal lensa ini + ada record Izin.
// - TIDAK_HADIR: tidak hadir + hari jadwal + tanpa izin.
// Union tanggal = jadwal ∪ hadir. Izin TIDAK menambah tanggal (izin off-day
// tidak tampil) sehingga pada kasus umum count(IZIN) == hariIzin agregat.
// Catatan jujur: pada overlap parsial (hadir sebagian di luar jadwal sekaligus
// ada jadwal tak dihadiri), count(TIDAK_HADIR) per tanggal bisa melebihi
// hariTanpaKeterangan agregat — karena agregat memakai formula net
// (jadwal − hadir − izin) sementara rincian menampilkan kebenaran per tanggal.
// Agregat Scope A TIDAK diubah (sudah terverifikasi); rincian apa adanya.
// Kalau 2+ attendance sehari (mis. 2 segmen PAM): 1 baris per tanggal,
// prioritas record non-PAM untuk detail fisik.

export type StatusHarian = "HADIR" | "IZIN" | "TIDAK_HADIR" | "DILUAR_JADWAL";

export type RincianHarian = {
  tanggal: string; // YYYY-MM-DD
  status: StatusHarian;
  isPam: boolean;
  menitTelat: number;
  potongan: number;
  // Hanya diisi saat status == "IZIN" (hadir menang: izin di hari hadir
  // dianggap terlewati dan alasannya tidak ditampilkan).
  alasanIzin: string | null;
};

export type RincianKehadiran = {
  employeeId: string;
  periode: string;
  storeId: string | null;
  items: RincianHarian[];
  ringkasan: {
    jadwalHari: number;
    hariHadir: number;
    hariIzin: number;
    hariTanpaKeterangan: number;
    hariDiLuarJadwal: number;
  };
};

export async function getRincianKehadiran(args: {
  employeeId: string;
  periode: string;
  awalBulan: Date;
  akhirBulan: Date;
  storeId?: string | null;
}): Promise<RincianKehadiran> {
  const { employeeId, periode, awalBulan, akhirBulan, storeId } = args;
  const lensStoreId = storeId ?? null;

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      employeeId,
      shiftInstance: {
        tanggal: { gte: awalBulan, lt: akhirBulan },
        statusJadwal: "APPROVED",
        ...(lensStoreId ? { storeId: lensStoreId } : {}),
      },
    },
    select: { shiftInstance: { select: { tanggal: true } } },
  });
  const jadwalSet = new Set(
    assignments.map((a) => tanggalKey(a.shiftInstance.tanggal))
  );

  const attendances = await prisma.attendance.findMany({
    where: {
      employeeId,
      tanggalShift: { gte: awalBulan, lt: akhirBulan },
      statusMasuk: "DIVERIFIKASI",
    },
    select: {
      tanggalShift: true,
      isPam: true,
      menitTelat: true,
      potongan: true,
      absenMasuk: true,
    },
    orderBy: { absenMasuk: "asc" },
  });
  // 1 tanggal -> 1 record (prioritas non-PAM).
  const hadirMap = new Map<string, (typeof attendances)[number]>();
  for (const a of attendances) {
    const key = tanggalKey(a.tanggalShift);
    const prev = hadirMap.get(key);
    if (!prev || (prev.isPam && !a.isPam)) hadirMap.set(key, a);
  }

  const izins = await prisma.izin.findMany({
    where: {
      employeeId,
      tanggal: { gte: awalBulan, lt: akhirBulan },
    },
    select: { tanggal: true, alasan: true },
  });
  const izinMap = new Map(
    izins.map((z) => [tanggalKey(z.tanggal), z.alasan])
  );

  const union = [...new Set([...jadwalSet, ...hadirMap.keys()])].sort();

  const items: RincianHarian[] = union.map((t) => {
    const hadir = hadirMap.get(t);
    if (hadir) {
      return {
        tanggal: t,
        status: (jadwalSet.has(t) ? "HADIR" : "DILUAR_JADWAL") as StatusHarian,
        isPam: hadir.isPam,
        menitTelat: hadir.menitTelat,
        potongan: hadir.potongan,
        alasanIzin: null,
      };
    }
    const alasan = izinMap.get(t) ?? null;
    return {
      tanggal: t,
      status: (alasan !== null ? "IZIN" : "TIDAK_HADIR") as StatusHarian,
      isPam: false,
      menitTelat: 0,
      potongan: 0,
      alasanIzin: alasan,
    };
  });

  const count = (s: StatusHarian) => items.filter((i) => i.status === s).length;
  return {
    employeeId,
    periode,
    storeId: lensStoreId,
    items,
    ringkasan: {
      jadwalHari: jadwalSet.size,
      hariHadir: hadirMap.size,
      hariIzin: count("IZIN"),
      hariTanpaKeterangan: count("TIDAK_HADIR"),
      hariDiLuarJadwal: count("DILUAR_JADWAL"),
    },
  };
}
