"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  formatJamWIB as jamWIB,
  formatTanggalPanjangWIB as tanggalWIB,
  mapsUrl,
} from "@/lib/absensi";

type Log = {
  fotoFileId: string | null;
  latitude: number | null;
  longitude: number | null;
  keteranganKoreksi: string | null;
};

type Item = {
  id: string;
  tanggalShift: string;
  absenMasuk: string;
  absenKeluar: string | null;
  statusMasuk: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK";
  statusKeluar: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK";
  menitTelat: number;
  potongan: number;
  totalMenitKerja: number;
  totalMenitManual: number | null;
  autoClosed: boolean;
  isPam: boolean;
  rejectedReason: string | null;
  logMasuk: Log | null;
  logKeluar: Log | null;
};

function rupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function badgeStatus(status: Item["statusMasuk"]): string {
  switch (status) {
    case "DIVERIFIKASI":
      return "bg-green-600/10 text-green-600 dark:text-green-400";
    case "DITOLAK":
      return "bg-red-600/10 text-red-600 dark:text-red-400";
    default:
      return "bg-amber-600/10 text-amber-600 dark:text-amber-400";
  }
}

function labelStatus(status: Item["statusMasuk"]): string {
  switch (status) {
    case "DIVERIFIKASI":
      return "Diterima";
    case "DITOLAK":
      return "Ditolak";
    default:
      return "Menunggu verifikasi";
  }
}

function Lokasi({ log }: { log: Log | null }) {
  if (!log || log.latitude === null || log.longitude === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <a
      href={mapsUrl(log.latitude, log.longitude)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)}
    </a>
  );
}

export function RiwayatAbsensi({ shiftAktifId }: { shiftAktifId: string | null }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/absensi/riwayat?limit=30")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Gagal (HTTP ${res.status})`);
        return data as { items: Item[] };
      })
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (items === null) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Memuat riwayat...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Belum ada riwayat absensi.
            </p>
          </CardContent>
        </Card>
      )}

      {items.map((a) => {
        const aktif = a.id === shiftAktifId;
        return (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {tanggalWIB(a.tanggalShift)}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeStatus(a.statusMasuk)}`}
                >
                  {labelStatus(a.statusMasuk)}
                </span>
                {a.isPam && (
                  <span className="rounded-full bg-amber-600/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    PAM
                  </span>
                )}
                {a.autoClosed && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    Auto-close
                  </span>
                )}
                {aktif && (
                  <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Shift berjalan
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Masuk {jamWIB(a.absenMasuk)} · Keluar {jamWIB(a.absenKeluar)}
                {a.statusKeluar !== "DIVERIFIKASI" && a.absenKeluar && (
                  <> ({labelStatus(a.statusKeluar).toLowerCase()})</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <p>
                  <span className="text-muted-foreground">Telat: </span>
                  {a.menitTelat} menit
                </p>
                <p>
                  <span className="text-muted-foreground">Potongan: </span>
                  {rupiah(a.potongan)}
                </p>
                <p>
                  <span className="text-muted-foreground">Jam kerja: </span>
                  {a.totalMenitKerja} menit
                  {/* Koreksi manual oleh admin (§7.1a) — shown to the employee so
                      the change is not hidden. */}
                  {a.totalMenitManual !== null && (
                    <span className="ml-1 text-amber-700 dark:text-amber-300">
                      (dikoreksi menjadi {a.totalMenitManual} menit)
                    </span>
                  )}
                </p>
              </div>
              {a.rejectedReason && (
                <p className="text-destructive">
                  Ditolak: {a.rejectedReason}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Masuk
                  </p>
                  <Lokasi log={a.logMasuk} />
                  {a.logMasuk?.keteranganKoreksi && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      Foto koreksi (diambil setelah penolakan, bukan saat check-in)
                    </p>
                  )}
                  {a.logMasuk?.fotoFileId && (
                    <img
                      src={`/api/telegram/file/${encodeURIComponent(a.logMasuk.fotoFileId)}`}
                      alt="Foto absen masuk"
                      className="mt-2 max-h-40 rounded border object-contain"
                    />
                  )}
                </div>
                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Keluar{a.autoClosed ? " (auto-close)" : ""}
                  </p>
                  <Lokasi log={a.logKeluar} />
                  {a.logKeluar?.fotoFileId && (
                    <img
                      src={`/api/telegram/file/${encodeURIComponent(a.logKeluar.fotoFileId)}`}
                      alt="Foto absen keluar"
                      className="mt-2 max-h-40 rounded border object-contain"
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Button asChild variant="outline">
        <Link href="/absensi">Kembali ke form absensi</Link>
      </Button>
    </div>
  );
}
