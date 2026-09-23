"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { format } from "date-fns";
import { id } from "date-fns/locale";

type PayrollData = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    kode: string;
    nama: string;
    role: string;
    tipePerhitunganGaji: string | null;
    tarifPerJam: number | null;
    storeId: string | null;
    store: { id: string; nama: string } | null;
  };
  periode: string;
  gajiPokok: number;
  totalHariKerja: number | null;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  bonusManual: number;
  potonganManual: number;
  bonusPerforma: number;
  keteranganBonusPerforma: string | null;
  totalGaji: number;
  status: string;
  lockedAt: string | null;
  lockedById: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

function formatTanggalLokal(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    return format(date, "d MMMM yyyy, HH:mm", { locale: id });
  } catch {
    return dateStr;
  }
}

const MAX_AMOUNT = 100_000_000;

type Props = {
  initialData: PayrollData;
};

export default function PayrollDetailClient({ initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState<PayrollData>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  const [bonusManual, setBonusManual] = useState(String(data.bonusManual));
  const [potonganManual, setPotonganManual] = useState(String(data.potonganManual));
  const [bonusPerforma, setBonusPerforma] = useState(String(data.bonusPerforma));
  const [keteranganBonusPerforma, setKeteranganBonusPerforma] = useState(
    data.keteranganBonusPerforma ?? ""
  );

  const isLocked = data.status === "LOCKED";

  const validateAmount = (value: string, fieldName: string): number | null => {
    if (value.trim() === "") return 0;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(`${fieldName} harus angka bulat >= 0.`);
    }
    if (num > MAX_AMOUNT) {
      throw new Error(`${fieldName} maksimal ${MAX_AMOUNT.toLocaleString("id-ID")}.`);
    }
    return num;
  };

  const handleSave = async () => {
    try {
      const validatedBonusManual = validateAmount(bonusManual, "Bonus Manual");
      const validatedPotonganManual = validateAmount(potonganManual, "Potongan Manual");
      const validatedBonusPerforma = validateAmount(bonusPerforma, "Bonus Performa");

      setIsSubmitting(true);
      const res = await fetch(`/api/payroll/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bonusManual: validatedBonusManual,
          potonganManual: validatedPotonganManual,
          bonusPerforma: validatedBonusPerforma,
          keteranganBonusPerforma: keteranganBonusPerforma.trim() || null,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(result.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Payroll berhasil diupdate.");
      // Refresh data from server
      const freshRes = await fetch(`/api/payroll/${data.id}`, { cache: "no-store" });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        setData(freshData);
      }
    } catch (e) {
      if (e instanceof Error) {
        toast.error(e.message);
      } else {
        toast.error("Terjadi kesalahan.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLock = async () => {
    if (!window.confirm("Setelah di-lock, payroll tidak bisa diubah lagi. Lanjutkan?")) {
      return;
    }

    setIsLocking(true);
    try {
      const res = await fetch(`/api/payroll/${data.id}/lock`, {
        method: "PATCH",
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(result.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Payroll berhasil di-lock.");
      // Refresh data from server
      const freshRes = await fetch(`/api/payroll/${data.id}`, { cache: "no-store" });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        setData(freshData);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsLocking(false);
    }
  };

  const calculateTotalGaji = () => {
    const baseGaji =
      data.totalGaji -
      data.totalBonusAgenda -
      data.bonusManual -
      data.bonusPerforma +
      data.totalPotonganTelat +
      data.potonganManual;

    const newBonusManual = bonusManual.trim() === "" ? 0 : Number(bonusManual);
    const newPotonganManual = potonganManual.trim() === "" ? 0 : Number(potonganManual);
    const newBonusPerforma = bonusPerforma.trim() === "" ? 0 : Number(bonusPerforma);

    return (
      baseGaji +
      data.totalBonusAgenda +
      newBonusManual +
      newBonusPerforma -
      data.totalPotonganTelat -
      newPotonganManual
    );
  };

  const previewTotalGaji = calculateTotalGaji();

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <Link
        href="/manajer/payroll"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Kembali ke Daftar Payroll
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Detail Payroll</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.employee.nama} ({data.employee.kode}) — {format(new Date(data.periode), "MMMM yyyy", { locale: id })}
        </p>
      </div>

      {/* Info Karyawan & Periode */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Info Karyawan & Periode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground">Nama</p>
              <p className="font-medium">{data.employee.nama}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Kode</p>
              <p className="font-mono font-medium">{data.employee.kode}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Role</p>
              <p>{data.employee.role}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Toko</p>
              <p>{data.employee.store?.nama ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tipe Perhitungan Gaji</p>
              <p>{data.employee.tipePerhitunganGaji ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tarif per Jam</p>
              <p>{formatRupiah(data.employee.tarifPerJam)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground">Periode</p>
              <p className="font-medium">{format(new Date(data.periode), "MMMM yyyy", { locale: id })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rincian Perhitungan Otomatis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rincian Perhitungan (Otomatis)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground">Gaji Pokok</p>
              <p className="font-mono font-medium">{formatRupiah(data.gajiPokok)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Hari Kerja</p>
              <p className="font-mono font-medium">
                {data.totalHariKerja !== null ? data.totalHariKerja : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Bonus Agenda</p>
              <p className="font-mono font-medium text-green-600 dark:text-green-400">
                {formatRupiah(data.totalBonusAgenda)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Potongan Telat</p>
              <p className="font-mono font-medium text-red-600 dark:text-red-400">
                {formatRupiah(data.totalPotonganTelat)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Input Manual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input Manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLocked && (
            <div className="text-sm text-muted-foreground">
              Payroll sudah di-lock pada {formatTanggalLokal(data.lockedAt)}. Tidak bisa mengubah field manual.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="bonusManual">Bonus Manual (Rp)</Label>
              <Input
                id="bonusManual"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={bonusManual}
                onChange={(e) => setBonusManual(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="potonganManual">Potongan Manual (Rp)</Label>
              <Input
                id="potonganManual"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={potonganManual}
                onChange={(e) => setPotonganManual(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bonusPerforma">Bonus Performa (Rp)</Label>
              <Input
                id="bonusPerforma"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={bonusPerforma}
                onChange={(e) => setBonusPerforma(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="keteranganBonusPerforma">Keterangan Bonus Performa (opsional)</Label>
              <textarea
                id="keteranganBonusPerforma"
                value={keteranganBonusPerforma}
                onChange={(e) => setKeteranganBonusPerforma(e.target.value)}
                disabled={isLocked || isSubmitting}
                rows={3}
                className="flex h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
              />
            </div>
          </div>
          {!isLocked && (
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Total Gaji */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Total Gaji</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-4">
          <p className="text-3xl font-bold font-mono text-primary">
            {formatRupiah(previewTotalGaji)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLocked ? "Final (sudah di-lock)" : "Preview — akan terupdate setelah Simpan"}
          </p>
        </CardContent>
      </Card>

      {/* Lock Button / Locked Info */}
      <Card>
        <CardContent className="space-y-3">
          {isLocked ? (
            <div className="space-y-1">
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                ✓ Payroll sudah di-lock
              </p>
              <p className="text-sm text-muted-foreground">
                Di-lock pada: {formatTanggalLokal(data.lockedAt)}
              </p>
            </div>
          ) : (
            <Button variant="destructive" onClick={handleLock} disabled={isLocking}>
              {isLocking ? "Memproses..." : "Lock Payroll (Finalisasi)"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}