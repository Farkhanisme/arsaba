import { prisma } from "@/lib/prisma";

// Komputasi Laporan Kehadiran (§8 spec: "Laporan Kehadiran & Izin").
// Dipakai oleh GET /api/laporan/kehadiran dan script uji.
//
// Definisi (nilai turunan, bukan record):
// - jadwalHari    = tanggal unik ShiftAssignment pada ShiftInstance APPROVED.
// - hariHadir     = tanggalShift unik Attendance statusMasuk DIVERIFIKASI
//                   (tanpa filter toko fisik — PAM di toko lain tetap "berangkat").
// - hariIzin      = tanggal Izin pada hari jadwal toko tsb yang TIDAK punya
//                   attendance terverifikasi (hadir menang atas izin;
//                   izin di hari tanpa jadwal tidak dihitung).
// - tanpaKeterangan = max(0, jadwal - hadir - izin).
// - diLuarJadwal  = max(0, hadir - jadwal).
// - hadirFisik    = tanggalShift unik DIVERIFIKASI dengan storeId = toko tsb.

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
  hariHadirFisik: number;
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
  const hadirRows = await prisma.attendance.groupBy({
    by: ["employeeId", "tanggalShift"],
    where: {
      tanggalShift: { gte: awalBulan, lt: akhirBulan },
      statusMasuk: "DIVERIFIKASI",
    },
    _count: { id: true },
  });

  // 3. Kehadiran fisik per toko (lensa fisik, termasuk PAM).
  const fisikRows = await prisma.attendance.groupBy({
    by: ["storeId", "employeeId", "tanggalShift"],
    where: {
      tanggalShift: { gte: awalBulan, lt: akhirBulan },
      statusMasuk: "DIVERIFIKASI",
      ...(tokoFilter ? { storeId: tokoFilter } : {}),
    },
    _count: { id: true },
  });

  // 4. Izin pada bulan berjalan.
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

  const fisikMap = new Map<string, Map<string, Set<string>>>(); // storeId -> employeeId -> Set<tanggal>
  for (const r of fisikRows) {
    let byEmp = fisikMap.get(r.storeId);
    if (!byEmp) {
      byEmp = new Map();
      fisikMap.set(r.storeId, byEmp);
    }
    let set = byEmp.get(r.employeeId);
    if (!set) {
      set = new Set();
      byEmp.set(r.employeeId, set);
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

  // 6. Bangun payload per toko.
  const stores: LaporanStore[] = [];
  for (const toko of tokoTampil) {
    const byEmpJadwal = jadwalMap.get(toko.id) ?? new Map<string, Set<string>>();
    const byEmpFisik = fisikMap.get(toko.id) ?? new Map<string, Set<string>>();
    const ids = new Set<string>([...byEmpJadwal.keys()]);
    for (const u of users) {
      if (u.storeId === toko.id && u.status === "AKTIF") ids.add(u.id);
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
      const hariHadirFisik = byEmpFisik.get(eid)?.size ?? 0;

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
        hariHadirFisik,
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
