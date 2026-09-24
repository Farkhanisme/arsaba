"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FotoList,
  SelisihBadge,
  StatusBadge,
  formatRupiah,
  formatTanggalJamWIB,
  periodeBulanBerjalanWIB,
  tujuanLabel,
  type SetoranItem,
} from "./shared";

export function RiwayatSetor({ refreshKey }: { refreshKey: number }) {
  const [periode, setPeriode] = useState(periodeBulanBerjalanWIB);
  const [items, setItems] = useState<SetoranItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batalId, setBatalId] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");
  const [membatalkan, setMembatalkan] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/setoran?arah=kirim&periode=${encodeURIComponent(periode)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && data.error) || `Gagal (HTTP ${res.status})`);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => {
    muat();
  }, [muat, refreshKey]);

  const handleBatal = async (id: string) => {
    if (!alasan.trim()) {
      toast.error("Alasan pembatalan wajib diisi.");
      return;
    }
    setMembatalkan(true);
    try {
      const res = await fetch(`/api/setoran/${encodeURIComponent(id)}/batal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan: alasan.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data && data.error) || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Setoran dibatalkan.");
      setBatalId(null);
      setAlasan("");
      muat();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setMembatalkan(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat Setoran Saya</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="periode">Periode</Label>
          <Input
            id="periode"
            type="month"
            className="w-auto"
            value={periode}
            onChange={(e) => e.target.value && setPeriode(e.target.value)}
          />
        </div>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={muat}>
              Coba lagi
            </Button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyStateCard
            title="Belum ada setoran"
            description={`Tidak ada setoran pada periode ${periode}.`}
            illustration="create"
          />
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      → {tujuanLabel(it)} · {formatRupiah(it.nominalDisetor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatTanggalJamWIB(it.disetorkanPada)} WIB
                      {it.keterangan ? ` · ${it.keterangan}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={it.status} />
                </div>

                {it.status === "DITERIMA" && (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      Diterima: {formatRupiah(it.nominalDiterima ?? 0)} oleh{" "}
                      {it.diterimaOlehNama ?? "-"} ·{" "}
                      {formatTanggalJamWIB(it.diterimaPada)} WIB
                    </p>
                    <SelisihBadge selisih={it.selisih} keterangan={it.keteranganSelisih} />
                    {it.selisih !== null && it.selisih !== 0 && it.keteranganSelisih && (
                      <p className="text-muted-foreground">Ket: {it.keteranganSelisih}</p>
                    )}
                  </div>
                )}

                {it.status === "DIBATALKAN" && it.alasanBatal && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Alasan batal: {it.alasanBatal}
                  </p>
                )}

                <div className="mt-2">
                  <FotoList bukti={it.bukti} jenis="SETOR" />
                </div>
                {it.bukti.some((b) => b.jenis === "TERIMA") && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-muted-foreground">Bukti terima:</p>
                    <FotoList bukti={it.bukti} jenis="TERIMA" />
                  </div>
                )}

                {it.status === "MENUNGGU_KONFIRMASI" && batalId !== it.id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setBatalId(it.id);
                      setAlasan("");
                    }}
                  >
                    Batalkan
                  </Button>
                )}
                {it.status === "MENUNGGU_KONFIRMASI" && batalId === it.id && (
                  <div className="mt-2 space-y-1">
                    <Label htmlFor={`alasan-${it.id}`}>Alasan pembatalan (wajib)</Label>
                    <Input
                      id={`alasan-${it.id}`}
                      type="text"
                      maxLength={200}
                      placeholder="cth. Salah input nominal"
                      value={alasan}
                      onChange={(e) => setAlasan(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={membatalkan}
                        onClick={() => handleBatal(it.id)}
                      >
                        {membatalkan ? "Membatalkan..." : "Ya, batalkan"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setBatalId(null);
                          setAlasan("");
                        }}
                      >
                        Kembali
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
