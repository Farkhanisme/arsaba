"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = {
  id: string;
  nama: string;
};

type Props = {
  stores: Store[];
};

type Preflight = {
  storeNama: string;
  jumlahTemplate: number;
  jumlahKaryawan: number;
  kapasitasPerShift: number;
  bisaGenerate: boolean;
  konflikTanggal: string[];
};

type Result = {
  batchId: string;
  periode: { tanggalMulai: string; tanggalSelesai: string };
  jumlahInstance: number;
  jumlahAssignment: number;
};

export function GenerateForm({ stores }: Props) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [tanggalMulai, setTanggalMulai] = useState("");
  const [jumlahHari, setJumlahHari] = useState("7");
  const [modeRotasi, setModeRotasi] = useState<"HARIAN" | "MINGGUAN">("HARIAN");

  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const fetchPreflight = useCallback(async () => {
    if (!storeId) {
      setPreflight(null);
      return;
    }
    setIsLoadingPreflight(true);
    try {
      const params = new URLSearchParams({ storeId });
      if (tanggalMulai) params.set("tanggalMulai", tanggalMulai);
      if (jumlahHari) params.set("jumlahHari", jumlahHari);

      const res = await fetch(
        `/api/shift-instance/generate/preflight?${params.toString()}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreflight(null);
        return;
      }
      setPreflight(data as Preflight);
    } catch {
      setPreflight(null);
    } finally {
      setIsLoadingPreflight(false);
    }
  }, [storeId, tanggalMulai, jumlahHari]);

  useEffect(() => {
    fetchPreflight();
  }, [fetchPreflight]);

  const submit = async () => {
    if (!storeId) {
      toast.error("Pilih toko terlebih dahulu.");
      return;
    }
    if (!tanggalMulai) {
      toast.error("Isi tanggal mulai.");
      return;
    }
    const n = Number(jumlahHari);
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      toast.error("Jumlah hari harus 1-31.");
      return;
    }
    if (preflight && !preflight.bisaGenerate) {
      toast.error("Toko belum siap untuk generate jadwal.");
      return;
    }
    if (preflight && preflight.konflikTanggal.length > 0) {
      toast.error(
        `Ada jadwal existing di ${preflight.konflikTanggal.length} tanggal. Hapus dulu jadwal tersebut.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/shift-instance/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          tanggalMulai,
          jumlahHari: n,
          modeRotasi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Jadwal berhasil dibuat.");
      setResult(data as Result);
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-semibold text-green-800">
            Jadwal berhasil dibuat.
          </p>
          <p className="mt-1">
            Periode: {result.periode.tanggalMulai} – {result.periode.tanggalSelesai}
          </p>
          <p>{result.jumlahInstance} instance · {result.jumlahAssignment} assignment</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            batch: {result.batchId}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => router.push("/jadwal")}>
            Lihat Jadwal
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResult(null);
              setTanggalMulai("");
            }}
          >
            Generate Lagi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="store">Toko</Label>
        <select
          id="store"
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          disabled={isSubmitting}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nama}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tanggalMulai">Tanggal mulai</Label>
          <Input
            id="tanggalMulai"
            type="date"
            value={tanggalMulai}
            onChange={(e) => setTanggalMulai(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="jumlahHari">Jumlah hari (1-31)</Label>
          <Input
            id="jumlahHari"
            type="number"
            min={1}
            max={31}
            value={jumlahHari}
            onChange={(e) => setJumlahHari(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Mode rotasi</Label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="modeRotasi"
              checked={modeRotasi === "HARIAN"}
              onChange={() => setModeRotasi("HARIAN")}
              disabled={isSubmitting}
            />
            Harian (rotasi tiap hari)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="modeRotasi"
              checked={modeRotasi === "MINGGUAN"}
              onChange={() => setModeRotasi("MINGGUAN")}
              disabled={isSubmitting}
            />
            Mingguan (rotasi tiap minggu)
          </label>
        </div>
      </div>

      {isLoadingPreflight && (
        <p className="text-sm text-muted-foreground">Memuat info...</p>
      )}

      {preflight && !isLoadingPreflight && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-semibold">Info pre-flight</p>
          <p>Toko: {preflight.storeNama}</p>
          <p>
            Shift template aktif: {preflight.jumlahTemplate} · Karyawan aktif:{" "}
            {preflight.jumlahKaryawan}
          </p>
          <p>
            Kapasitas per shift: {preflight.kapasitasPerShift} karyawan
          </p>
          {!preflight.bisaGenerate && (
            <p className="text-destructive">
              Toko belum siap (butuh ≥1 template + karyawan cukup).
            </p>
          )}
          {preflight.konflikTanggal.length > 0 && (
            <div className="text-destructive">
              <p>Konflik tanggal (sudah ada jadwal):</p>
              <p className="font-mono text-xs">
                {preflight.konflikTanggal.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button
          type="button"
          onClick={submit}
          disabled={
            isSubmitting ||
            !storeId ||
            !tanggalMulai ||
            (preflight !== null && !preflight.bisaGenerate)
          }
        >
          {isSubmitting ? "Memproses..." : "Generate Jadwal"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/jadwal")}
          disabled={isSubmitting}
        >
          Batal
        </Button>
      </div>
    </div>
  );
}
