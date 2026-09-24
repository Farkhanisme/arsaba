"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import type {
  LaporanKaryawan,
  LaporanKehadiran,
  LaporanStore,
  RincianHarian,
  RincianKehadiran,
} from "@/lib/laporan-kehadiran";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function bulanBerjalanWIB(): string {
  const wib = new Date(Date.now() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}`;
}

function tanggalWIB(offsetHari: number): string {
  const wib = new Date(Date.now() + WIB_OFFSET_MS + offsetHari * 24 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function formatPersen(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}%`;
}

function formatTanggalID(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function badgeStatus(s: RincianHarian["status"]): string {
  switch (s) {
    case "HADIR":
      return "bg-green-600/10 text-green-600 dark:text-green-400";
    case "IZIN":
      return "bg-blue-600/10 text-blue-600 dark:text-blue-400";
    case "TIDAK_HADIR":
      return "bg-red-600/10 text-red-600 dark:text-red-400";
    case "DILUAR_JADWAL":
      return "bg-amber-600/10 text-amber-600 dark:text-amber-400";
  }
}

function labelStatus(s: RincianHarian["status"]): string {
  switch (s) {
    case "HADIR":
      return "Hadir";
    case "IZIN":
      return "Izin";
    case "TIDAK_HADIR":
      return "Tanpa ket.";
    case "DILUAR_JADWAL":
      return "Luar jadwal";
  }
}

type IzinRow = { id: string; tanggal: string; alasan: string };

function SpinnerIcon({ className = "h-4 w-4 text-primary" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function ChevronIcon({ open, className = "h-4 w-4" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className} text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export default function KehadiranReport({ canMarkIzin }: { canMarkIzin: boolean }) {
  const [periode, setPeriode] = useState(bulanBerjalanWIB);
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<LaporanKehadiran | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  // Rincian per tanggal (B.2): expand per baris karyawan. Key gabungan
  // `${periode}|${storeId}|${employeeId}` agar lensa ganda (P1: karyawan tampil
  // di 2 toko) tidak bertabrakan dan cache tidak basi saat periode diganti.
  const [expandedKaryawan, setExpandedKaryawan] = useState<Set<string>>(new Set());
  const [rincianCache, setRincianCache] = useState<Map<string, RincianKehadiran>>(new Map());
  const [rincianLoading, setRincianLoading] = useState<Set<string>>(new Set());
  const [rincianError, setRincianError] = useState<Map<string, string>>(new Map());

  // Form "Tandai Izin" inline per baris karyawan.
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [izinTanggal, setIzinTanggal] = useState("");
  const [izinAlasan, setIzinAlasan] = useState("");
  const [saving, setSaving] = useState(false);

  // Daftar izin karyawan pada periode laporan (untuk aksi Batalkan).
  const [izinRows, setIzinRows] = useState<IzinRow[]>([]);
  const [izinLoading, setIzinLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ periode });
      if (storeId) params.set("storeId", storeId);
      const res = await fetch(`/api/laporan/kehadiran?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as LaporanKehadiran;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, [periode, storeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleStore = (id: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rincianKey = (storeId: string, employeeId: string) =>
    `${periode}|${storeId}|${employeeId}`;

  // Controller per key agar fetch yang masih jalan bisa dibatalkan
  // (collapse saat loading / retry cepat / ganti filter / unmount).
  const rincianControllers = useRef<Map<string, AbortController>>(new Map());

  const fetchRincian = async (storeId: string, employeeId: string) => {
    const key = rincianKey(storeId, employeeId);
    rincianControllers.current.get(key)?.abort();
    const controller = new AbortController();
    rincianControllers.current.set(key, controller);
    setRincianLoading((prev) => new Set(prev).add(key));
    setRincianError((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    try {
      const params = new URLSearchParams({
        periode,
        employeeId,
        storeId,
      });
      const res = await fetch(`/api/laporan/kehadiran/rincian?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRincianCache((prev) => new Map(prev).set(key, json as RincianKehadiran));
    } catch (e) {
      // Fetch yang dibatalkan bukan error: jangan tulis state error/loading basi.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setRincianError((prev) =>
        new Map(prev).set(key, e instanceof Error ? e.message : "Gagal memuat rincian")
      );
    } finally {
      if (rincianControllers.current.get(key) === controller) {
        rincianControllers.current.delete(key);
      }
      setRincianLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleRincian = (store: LaporanStore, k: LaporanKaryawan) => {
    const key = rincianKey(store.storeId, k.employeeId);
    if (expandedKaryawan.has(key)) {
      // Collapse saat fetch masih jalan → batalkan agar respons basi
      // tidak menulis cache/error setelah baris ditutup.
      rincianControllers.current.get(key)?.abort();
      rincianControllers.current.delete(key);
      setExpandedKaryawan((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return; // cache dibiarkan
    }
    setExpandedKaryawan((prev) => new Set(prev).add(key));
    if (rincianCache.has(key)) return; // cache penuh → langsung render
    void fetchRincian(store.storeId, k.employeeId);
  };

  // Ganti filter periode/toko → buang seluruh state rincian: cache tidak
  // tumbuh tanpa batas dan tidak ada baris expanded basi dari filter lama.
  useEffect(() => {
    for (const c of rincianControllers.current.values()) c.abort();
    rincianControllers.current.clear();
    setExpandedKaryawan(new Set());
    setRincianCache(new Map());
    setRincianLoading(new Set());
    setRincianError(new Map());
  }, [periode, storeId]);

  // Unmount → batalkan semua fetch rincian yang masih jalan.
  useEffect(() => {
    const controllers = rincianControllers.current;
    return () => {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
    };
  }, []);

  const openMarking = (employeeId: string) => {
    setMarkingId(employeeId);
    setIzinTanggal(tanggalWIB(0));
    setIzinAlasan("");
    setIzinRows([]);
    void loadIzin(employeeId);
  };

  const loadIzin = useCallback(
    async (employeeId: string) => {
      setIzinLoading(true);
      try {
        const params = new URLSearchParams({ periode, employeeId });
        const res = await fetch(`/api/izin?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => ({}));
        const items = Array.isArray(json.items) ? json.items : [];
        items.sort((a: IzinRow, b: IzinRow) =>
          b.tanggal.localeCompare(a.tanggal)
        );
        setIzinRows(
          items.map((i: IzinRow) => ({
            id: i.id,
            tanggal: i.tanggal,
            alasan: i.alasan,
          }))
        );
      } catch {
        setIzinRows([]);
      } finally {
        setIzinLoading(false);
      }
    },
    [periode]
  );

  const cancelIzin = async (
    id: string,
    tanggal: string,
    employeeId: string
  ) => {
    if (!window.confirm(`Batalkan izin ${formatTanggalID(tanggal)}?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/izin/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success("Izin dibatalkan.");
      await loadIzin(employeeId);
      await fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membatalkan izin.");
    } finally {
      setSaving(false);
    }
  };

  const submitIzin = async (employeeId: string) => {
    if (!izinTanggal) {
      toast.error("Isi tanggal izin.");
      return;
    }
    if (izinTanggal < hariIni) {
      toast.error("Tidak dapat menandai izin di tanggal yang sudah lewat.");
      return;
    }
    if (izinAlasan.trim().length === 0) {
      toast.error("Isi alasan izin.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/izin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          tanggal: izinTanggal,
          alasan: izinAlasan.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success("Izin berhasil ditandai.");
      setMarkingId(null);
      setIzinAlasan("");
      await fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menandai izin.");
    } finally {
      setSaving(false);
    }
  };

  const stores = data?.stores ?? [];
  const hariIni = tanggalWIB(0); // YYYY-MM-DD hari ini (WIB)
  const ringkasan = stores.reduce(
    (s, t) => ({
      karyawan: s.karyawan + t.totalKaryawan,
      jadwal: s.jadwal + t.totalHariJadwal,
      hadir: s.hadir + t.totalHariHadir,
      izin: s.izin + t.totalHariIzin,
      tanpaKet: s.tanpaKet + t.totalHariTanpaKeterangan,
      tidakHadir: s.tidakHadir + t.totalHariTidakHadir,
    }),
    { karyawan: 0, jadwal: 0, hadir: 0, izin: 0, tanpaKet: 0, tidakHadir: 0 }
  );
  // Persen agregat lintas toko (mengandung double-count lensa P1 — caption
  // di bawah grid sudah menjelaskan).
  const persenAgregat =
    ringkasan.jadwal > 0 ? (ringkasan.hadir / ringkasan.jadwal) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Filter */}
      <Card>
        <CardContent className="pt-4 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="periode" className="text-xs font-medium text-muted-foreground">
              Periode
            </label>
            <input
              id="periode"
              type="month"
              value={periode}
              onChange={(e) => e.target.value && setPeriode(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1 sm:min-w-56">
            <label htmlFor="toko" className="text-xs font-medium text-muted-foreground">
              Toko
            </label>
            <Select
              id="toko"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">Semua toko</option>
              {(data?.daftarToko ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nama}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="flex justify-center items-center gap-2">
              <SpinnerIcon className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">Memuat laporan kehadiran...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="pt-6 text-center text-red-600 dark:text-red-400">
            <p className="text-sm">Gagal memuat laporan kehadiran: {error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchData}>
              Coba lagi
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          {/* Ringkasan */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Karyawan</p>
                <p className="text-2xl font-bold font-mono">{ringkasan.karyawan}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Hari Jadwal</p>
                <p className="text-2xl font-bold font-mono">{ringkasan.jadwal}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Hari Hadir</p>
                <p className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">{ringkasan.hadir}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Izin</p>
                <p className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">{ringkasan.izin}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Tanpa Keterangan</p>
                <p className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{ringkasan.tanpaKet}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Tidak Hadir</p>
                <p className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{ringkasan.tidakHadir}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">%</p>
                <p
                  className={`text-2xl font-bold font-mono ${
                    persenAgregat !== null && persenAgregat < 80
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  }`}
                >
                  {formatPersen(persenAgregat)}
                </p>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Total lintas toko = penjumlahan lensa per toko; karyawan lintas toko dapat terhitung di dua toko.
          </p>

          {/* Per toko */}
          {stores.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground text-sm">
                Belum ada data untuk periode ini.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {stores.map((store) => {
                const isExpanded = expandedStores.has(store.storeId);
                return (
                  <div key={store.storeId} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleStore(store.storeId)}
                      className="w-full px-4 py-3 bg-muted/50 hover:bg-muted text-left flex items-center justify-between gap-4 transition-colors"
                    >
                      <div>
                        <p className="font-medium">{store.storeNama}</p>
                        <p className="text-sm text-muted-foreground">
                          {store.totalKaryawan} karyawan · Hadir {store.totalHariHadir}/{store.totalHariJadwal} hari
                          {store.totalHariTanpaKeterangan > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              {" "}· {store.totalHariTanpaKeterangan} tanpa keterangan
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span
                          className={`font-mono font-medium ${
                            store.persentaseKehadiran !== null &&
                            store.persentaseKehadiran < 80
                              ? "text-red-600 dark:text-red-400"
                              : ""
                          }`}
                        >
                          {formatPersen(store.persentaseKehadiran)}
                        </span>
                        <ChevronIcon open={isExpanded} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 border-t bg-background">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2 pr-1 font-medium w-8" />
                                <th className="pb-2 pr-3 font-medium">Kode</th>
                                <th className="pb-2 pr-3 font-medium">Nama</th>
                                <th className="pb-2 pr-3 font-medium">Status</th>
                                <th className="pb-2 pr-3 font-medium">Tipe</th>
                                <th className="pb-2 pr-3 font-medium text-right">Jadwal</th>
                                <th className="pb-2 pr-3 font-medium text-right">Hadir</th>
                                <th className="pb-2 pr-3 font-medium text-right">Izin</th>
                                <th className="pb-2 pr-3 font-medium text-right">Tanpa Ket.</th>
                                <th className="pb-2 pr-3 font-medium text-right">Luar Jadwal</th>
                                <th className="pb-2 pr-3 font-medium text-right">Fisik</th>
                                <th className="pb-2 pr-3 font-medium text-right">%</th>
                                {canMarkIzin && <th className="pb-2 font-medium" />}
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {store.karyawan.map((k) => {
                                const rKey = rincianKey(store.storeId, k.employeeId);
                                const isRincianOpen = expandedKaryawan.has(rKey);
                                const rincian = rincianCache.get(rKey);
                                const rincianErr = rincianError.get(rKey);
                                return (
                                <Fragment key={k.employeeId}>
                                  <tr className="hover:bg-muted/50">
                                    <td className="py-3 pr-1">
                                      <button
                                        onClick={() => toggleRincian(store, k)}
                                        aria-label={isRincianOpen ? "Tutup rincian harian" : "Lihat rincian harian"}
                                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      >
                                        <svg
                                          className={`h-4 w-4 transition-transform ${isRincianOpen ? "rotate-180" : ""}`}
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                          aria-hidden="true"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    </td>
                                    <td className="py-3 pr-3 font-mono">{k.kode}</td>
                                    <td className="py-3 pr-3">{k.nama}</td>
                                    <td className="py-3 pr-3 text-muted-foreground">{k.status}</td>
                                    <td className="py-3 pr-3 text-muted-foreground">{k.tipePerhitunganGaji ?? "—"}</td>
                                    <td className="py-3 pr-3 text-right font-mono">{k.jadwalHari}</td>
                                    <td className="py-3 pr-3 text-right font-mono text-green-600 dark:text-green-400">{k.hariHadir}</td>
                                    <td className="py-3 pr-3 text-right font-mono text-blue-600 dark:text-blue-400">{k.hariIzin}</td>
                                    <td className="py-3 pr-3 text-right font-mono text-red-600 dark:text-red-400">{k.hariTanpaKeterangan}</td>
                                    <td className="py-3 pr-3 text-right font-mono">{k.hariDiLuarJadwal}</td>
                                    <td className="py-3 pr-3 text-right font-mono">{k.hariHadirFisik}</td>
                                    <td
                                      className={`py-3 pr-3 text-right font-mono font-medium ${
                                        k.persentaseKehadiran !== null &&
                                        k.persentaseKehadiran < 80
                                          ? "text-red-600 dark:text-red-400"
                                          : ""
                                      }`}
                                    >
                                      {formatPersen(k.persentaseKehadiran)}
                                    </td>
                                    {canMarkIzin && (
                                      <td className="py-3 text-right">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            markingId === k.employeeId
                                              ? setMarkingId(null)
                                              : openMarking(k.employeeId)
                                          }
                                        >
                                          Tandai Izin
                                        </Button>
                                      </td>
                                    )}
                                  </tr>
                                  {isRincianOpen && (
                                    <tr className="bg-muted/20">
                                      <td colSpan={canMarkIzin ? 13 : 12} className="p-3">
                                        {rincianLoading.has(rKey) ? (
                                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <SpinnerIcon />
                                            <span>Memuat rincian...</span>
                                          </div>
                                        ) : rincianErr ? (
                                          <div className="flex items-center gap-2 text-sm">
                                            <span className="text-red-600 dark:text-red-400">
                                              Gagal memuat rincian: {rincianErr}
                                            </span>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => void fetchRincian(store.storeId, k.employeeId)}
                                            >
                                              Coba lagi
                                            </Button>
                                          </div>
                                        ) : !rincian || rincian.items.length === 0 ? (
                                          <p className="text-sm text-muted-foreground">
                                            Belum ada data rincian untuk periode ini.
                                          </p>
                                        ) : (
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                              <thead>
                                                <tr className="border-b text-left text-muted-foreground">
                                                  <th className="pb-2 pr-3 font-medium">Tanggal</th>
                                                  <th className="pb-2 pr-3 font-medium">Status</th>
                                                  <th className="pb-2 pr-3 font-medium">Toko Fisik</th>
                                                  <th className="pb-2 pr-3 font-medium">PAM</th>
                                                  <th className="pb-2 pr-3 font-medium text-right">Telat</th>
                                                  <th className="pb-2 pr-3 font-medium text-right">Potongan</th>
                                                  <th className="pb-2 font-medium">Alasan</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y">
                                                {rincian.items.map((item) => (
                                                  <tr key={item.tanggal} className="hover:bg-muted/50">
                                                    <td className="py-2 pr-3 font-mono">
                                                      {formatTanggalID(item.tanggal)}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                      <span
                                                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeStatus(item.status)}`}
                                                      >
                                                        {labelStatus(item.status)}
                                                      </span>
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                      {item.storeFisikNama ?? "—"}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                      {item.isPam ? (
                                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-600/10 text-amber-600 dark:text-amber-400">
                                                          PAM
                                                        </span>
                                                      ) : (
                                                        "—"
                                                      )}
                                                    </td>
                                                    <td
                                                      className={`py-2 pr-3 text-right font-mono ${
                                                        item.menitTelat > 0
                                                          ? "text-red-600 dark:text-red-400"
                                                          : ""
                                                      }`}
                                                    >
                                                      {item.menitTelat > 0 ? `${item.menitTelat} mnt` : "—"}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right font-mono">
                                                      {item.potongan > 0 ? formatRupiah(item.potongan) : "—"}
                                                    </td>
                                                    <td className="py-2">{item.alasanIzin ?? "—"}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                  {markingId === k.employeeId && (
                                    <tr className="bg-muted/30">
                                      <td colSpan={canMarkIzin ? 13 : 12} className="p-3">
                                        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                                          <div className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground">Tanggal</span>
                                            <input
                                              type="date"
                                              value={izinTanggal}
                                              min={hariIni}
                                              onChange={(e) => setIzinTanggal(e.target.value)}
                                              className="rounded-md border bg-background px-2 py-1.5 text-sm"
                                            />
                                          </div>
                                          <div className="flex gap-2">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => setIzinTanggal(tanggalWIB(0))}
                                            >
                                              Hari ini
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => setIzinTanggal(tanggalWIB(1))}
                                            >
                                              Besok
                                            </Button>
                                          </div>
                                          <div className="flex flex-col gap-1 flex-1">
                                            <span className="text-xs text-muted-foreground">Alasan</span>
                                            <input
                                              type="text"
                                              value={izinAlasan}
                                              onChange={(e) => setIzinAlasan(e.target.value)}
                                              placeholder="cth. Sakit, acara keluarga"
                                              maxLength={200}
                                              className="rounded-md border bg-background px-2 py-1.5 text-sm"
                                            />
                                          </div>
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              disabled={saving}
                                              onClick={() => submitIzin(k.employeeId)}
                                            >
                                              {saving ? "Menyimpan..." : "Simpan"}
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              disabled={saving}
                                              onClick={() => setMarkingId(null)}
                                            >
                                              Batal
                                            </Button>
                                          </div>
                                        </div>
                                        {/* Daftar izin periode ini + aksi Batalkan */}
                                        <div className="mt-3 border-t pt-3">
                                          <p className="text-xs font-medium text-muted-foreground">
                                            Izin pada periode {periode}
                                          </p>
                                          {izinLoading ? (
                                            <p className="mt-1 text-xs text-muted-foreground">
                                              Memuat daftar izin...
                                            </p>
                                          ) : izinRows.length === 0 ? (
                                            <p className="mt-1 text-xs text-muted-foreground">
                                              Belum ada izin untuk periode ini.
                                            </p>
                                          ) : (
                                            <ul className="mt-1 space-y-1">
                                              {izinRows.map((r) => {
                                                // YYYY-MM-DD: perbandingan leksikografis = kronologis.
                                                const sudahLewat = r.tanggal < hariIni;
                                                return (
                                                  <li
                                                    key={r.id}
                                                    className="flex items-center justify-between gap-2 text-sm"
                                                  >
                                                    <span>
                                                      {formatTanggalID(r.tanggal)} — {r.alasan}
                                                      {sudahLewat && (
                                                        <span className="text-muted-foreground">
                                                          {" "}
                                                          (sudah lewat)
                                                        </span>
                                                      )}
                                                    </span>
                                                    {canMarkIzin && !sudahLewat && (
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={saving}
                                                        onClick={() =>
                                                          cancelIzin(
                                                            r.id,
                                                            r.tanggal,
                                                            k.employeeId
                                                          )
                                                        }
                                                      >
                                                        Batalkan
                                                      </Button>
                                                    )}
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
