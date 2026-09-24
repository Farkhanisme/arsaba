"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import type { Role } from "@prisma/client";

type StoreData = {
  storeId: string;
  storeNama: string;
  totalEstimasi: number;
  jumlahKaryawan: number;
  karyawan: KaryawanData[];
};

type KaryawanData = {
  employeeId: string;
  kode: string;
  nama: string;
  tipePerhitunganGaji: string | null;
  baseGaji: number;
  totalHariKerja: number;
  totalMenitKerja: number;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  estimasiGaji: number;
};

type PersonalData = {
  employeeId: string;
  kode: string;
  nama: string;
  storeNama: string;
  tipePerhitunganGaji: string;
  baseGaji: number;
  totalHariKerja: number;
  totalMenitKerja: number;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  estimasiGaji: number;
};

type DashboardResponse =
  | {
      view: "cross-store";
      periode: string;
      role: Role;
      totalEstimasiPayroll: number;
      totalKaryawan: number;
      stores: StoreData[];
    }
  | {
      view: "personal";
      periode: string;
      role: Role;
      karyawan: PersonalData | null;
      message?: string;
    };

function formatPeriode(periode: string): string {
  const [year, month] = periode.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
}

function CrossStoreView({ data }: { data: Extract<DashboardResponse, { view: "cross-store" }> }) {
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  const toggleStore = (storeId: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Ringkasan */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Estimasi Payroll</p>
            <p className="text-2xl font-bold font-mono text-primary">{formatRupiah(data.totalEstimasiPayroll)}</p>
            <p className="text-xs text-muted-foreground mt-1">ESTIMASI — belum termasuk bonus/potongan manual Manajer</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Karyawan Aktif</p>
            <p className="text-2xl font-bold font-mono">{data.totalKaryawan} orang</p>
            <p className="text-xs text-muted-foreground mt-1">Dengan tipe perhitungan gaji sudah di-set</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Periode</p>
            <p className="text-2xl font-bold font-mono">{formatPeriode(data.periode)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabel per Store */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estimasi Gaji per Toko (Bulan {formatPeriode(data.periode)})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.stores.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Belum ada karyawan dengan tipe perhitungan gaji yang di-set.
            </p>
          ) : (
            <div className="space-y-4">
              {data.stores.map((store) => {
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
                          {store.jumlahKaryawan} karyawan
                        </p>
                      </div>
                      <div className="flex items-center gap-4 font-mono">
                        <span className="text-right">
                          <span className="font-medium">{formatRupiah(store.totalEstimasi)}</span>
                          <span className="text-xs text-muted-foreground ml-2">ESTIMASI</span>
                        </span>
                        <svg
                          className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 border-t bg-background">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2 font-medium">Kode</th>
                                <th className="pb-2 font-medium">Nama</th>
                                <th className="pb-2 font-medium">Tipe</th>
                                <th className="pb-2 font-medium text-right">Base Gaji</th>
                                <th className="pb-2 font-medium text-right">Hari Kerja</th>
                                <th className="pb-2 font-medium text-right">Bonus Agenda</th>
                                <th className="pb-2 font-medium text-right">Potongan Telat</th>
                                <th className="pb-2 font-medium text-right">Estimasi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {store.karyawan.map((k) => (
                                <tr key={k.employeeId} className="hover:bg-muted/50">
                                  <td className="py-3 font-mono">{k.kode}</td>
                                  <td className="py-3">{k.nama}</td>
                                  <td className="py-3 text-muted-foreground">{k.tipePerhitunganGaji ?? "—"}</td>
                                  <td className="py-3 text-right font-mono">{formatRupiah(k.baseGaji)}</td>
                                  <td className="py-3 text-right font-mono">{k.totalHariKerja}</td>
                                  <td className="py-3 text-right font-mono text-green-600 dark:text-green-400">
                                    {formatRupiah(k.totalBonusAgenda)}
                                  </td>
                                  <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">
                                    {formatRupiah(k.totalPotonganTelat)}
                                  </td>
                                  <td className="py-3 text-right font-bold font-mono text-primary">
                                    {formatRupiah(k.estimasiGaji)}
                                    <span className="text-xs text-muted-foreground font-normal ml-1">EST</span>
                                  </td>
                                </tr>
                              ))}
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
        </CardContent>
      </Card>
    </div>
  );
}

function PersonalView({ data }: { data: Extract<DashboardResponse, { view: "personal" }> }) {
  if (!data.karyawan) {
    return (
      <Card className="border-yellow-200 dark:border-yellow-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm">{data.message ?? "Tipe perhitungan gaji belum diatur. Hubungi Manajer."}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const k = data.karyawan;

  return (
    <div className="space-y-6">
      {/* Card Utama - Estimasi Gaji */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6 pb-8">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Estimasi Gaji Bulan {formatPeriode(data.periode)}</p>
            <p className="text-4xl font-bold font-mono text-primary">{formatRupiah(k.estimasiGaji)}</p>
            <p className="text-xs text-muted-foreground">
              ESTIMASI — angka final dapat berubah setelah input manual Manajer (bonus/potongan/performa)
            </p>
            <p className="text-xs text-muted-foreground">
              Toko: {k.storeNama} · Tipe: {k.tipePerhitunganGaji}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rincian Perhitungan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-700 dark:text-green-300">Base Gaji</p>
              <p className="text-xl font-bold font-mono text-green-900 dark:text-green-100">
                {formatRupiah(k.baseGaji)}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {k.tipePerhitunganGaji === "HARIAN" && `Tarif × 8 × ${k.totalHariKerja} hari`}
                {k.tipePerhitunganGaji === "BULANAN" && "Gaji pokok bulanan"}
                {k.tipePerhitunganGaji === "JAM" && `Tarif × ${Math.floor(k.totalMenitKerja / 60)} jam`}
              </p>
            </div>
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">Bonus Agenda</p>
              <p className="text-xl font-bold font-mono text-blue-900 dark:text-blue-100">
                {formatRupiah(k.totalBonusAgenda)}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Dari agenda terverifikasi (DIVERIFIKASI)
              </p>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300">Potongan Keterlambatan</p>
              <p className="text-xl font-bold font-mono text-red-900 dark:text-red-100">
                {formatRupiah(k.totalPotonganTelat)}
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                Rp 1.000/menit dari absen terverifikasi
              </p>
            </div>
          </div>

          {/* Detail tambahan */}
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-muted-foreground">Total Hari Kerja (terverifikasi)</p>
              <p className="font-mono font-medium">{k.totalHariKerja} hari</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-muted-foreground">Total Menit Kerja</p>
              <p className="font-mono font-medium">
                {k.totalMenitKerja} menit ({Math.floor(k.totalMenitKerja / 60)} jam {k.totalMenitKerja % 60} menit)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Catatan penting */}
      <Card className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              <p className="font-medium">Ini adalah ESTIMASI, bukan gaji final.</p>
              <p className="mt-1">
                Angka di atas hanya mencakup: base gaji + bonus agenda terverifikasi - potongan keterlambatan.
                <strong>Belum termasuk:</strong> bonus manual, potongan manual, dan bonus performa dari Manajer.
                Nilai final akan terlihat di halaman Payroll setelah Manajer generate dan lock payroll bulanan.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EstimasiGajiDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/dashboard/gaji", { cache: "no-store" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <div className="flex justify-center items-center gap-2">
            <svg className="animate-spin h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm text-muted-foreground">Memuat estimasi gaji...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="pt-6 text-center text-red-600 dark:text-red-400">
          <p className="text-sm">Gagal memuat estimasi gaji: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Estimasi Gaji</h2>
          <p className="text-sm text-muted-foreground">
            {data.view === "cross-store"
              ? "Dashboard lintas toko untuk Manajer/Admin/Supervisor/Direktur"
              : "Dashboard pribadi estimasi gaji bulan berjalan"}
          </p>
        </div>
        <span
          className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
        >
          ESTIMASI
        </span>
      </div>

      {data.view === "cross-store" ? (
        <CrossStoreView data={data} />
      ) : (
        <PersonalView data={data} />
      )}
    </div>
  );
}