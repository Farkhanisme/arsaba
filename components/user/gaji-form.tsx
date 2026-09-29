"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { TipePerhitunganGaji } from "@prisma/client";

type Props = {
  userId: string;
  initial: {
    tipePerhitunganGaji: TipePerhitunganGaji | null;
    tarifPerJam: number | null;
    tarifPerHari: number | null;
    nominalGajiPokok: number | null;
  };
};

const TIPE_OPTIONS: TipePerhitunganGaji[] = ["HARIAN", "BULANAN", "JAM"];

/** Field tarif wajib per tipe — cerminan `validasiTarif` di lib/gaji.ts. */
const TARIF_WAJIB: Record<TipePerhitunganGaji, string> = {
  HARIAN: "Tarif harian",
  BULANAN: "Gaji pokok bulanan",
  JAM: "Tarif per jam",
};

export function GajiForm({ userId, initial }: Props) {
  const router = useRouter();
  const [tipe, setTipe] = useState<TipePerhitunganGaji | "">(
    initial.tipePerhitunganGaji ?? ""
  );
  const [tarifPerJam, setTarifPerJam] = useState(
    initial.tarifPerJam !== null ? String(initial.tarifPerJam) : ""
  );
  const [tarifPerHari, setTarifPerHari] = useState(
    initial.tarifPerHari !== null ? String(initial.tarifPerHari) : ""
  );
  const [nominalGajiPokok, setNominalGajiPokok] = useState(
    initial.nominalGajiPokok !== null ? String(initial.nominalGajiPokok) : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (tipe === "") {
      toast.error("Pilih tipe perhitungan gaji.");
      return;
    }

    // Setiap tipe punya tarif wajibnya sendiri (lihat lib/gaji.ts).
    const wajib = TARIF_WAJIB[tipe as TipePerhitunganGaji];
    const nilaiWajib =
      tipe === "JAM" ? tarifPerJam : tipe === "HARIAN" ? tarifPerHari : nominalGajiPokok;
    if (nilaiWajib.trim() === "") {
      toast.error(`Tipe ${tipe} wajib mengisi ${wajib.toLowerCase()}.`);
      return;
    }

    const body: Record<string, unknown> = {
      tipePerhitunganGaji: tipe,
    };

    const cekAngka = (v: string, nama: string): number | null => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        toast.error(`${nama} harus angka bulat >= 0.`);
        return null;
      }
      return n;
    };

    if (tipe === "JAM") {
      const v = cekAngka(tarifPerJam, "Tarif per jam");
      if (v === null) return;
      body.tarifPerJam = v;
    } else if (tipe === "HARIAN") {
      const v = cekAngka(tarifPerHari, "Tarif harian");
      if (v === null) return;
      body.tarifPerHari = v;
    } else {
      const v = cekAngka(nominalGajiPokok, "Gaji pokok bulanan");
      if (v === null) return;
      body.nominalGajiPokok = v;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/user/${userId}/gaji`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Gaji berhasil disimpan.");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`tipe-${userId}`}>Tipe perhitungan gaji</Label>
        <Select
          id={`tipe-${userId}`}
          value={tipe}
          onChange={(e) =>
            setTipe(e.target.value as TipePerhitunganGaji | "")
          }
          disabled={isSubmitting}
        >
          <option value="">— belum ditentukan —</option>
          {TIPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>

      {tipe === "JAM" && (
        <div className="space-y-1">
          <Label htmlFor={`tarif-${userId}`}>Tarif per jam (Rp) — wajib</Label>
          <Input
            id={`tarif-${userId}`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 15000"
            value={tarifPerJam}
            onChange={(e) => setTarifPerJam(e.target.value)}
            disabled={isSubmitting}
          />
          {initial.tarifPerJam !== null && (
            <p className="text-xs text-muted-foreground">
              Saat ini: Rp {initial.tarifPerJam.toLocaleString("id-ID")}
            </p>
          )}
        </div>
      )}

      {tipe === "HARIAN" && (
        <div className="space-y-1">
          <Label htmlFor={`tarifHari-${userId}`}>Tarif harian (Rp) — wajib</Label>
          <Input
            id={`tarifHari-${userId}`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 120000"
            value={tarifPerHari}
            onChange={(e) => setTarifPerHari(e.target.value)}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Gaji pokok = tarif ini × jumlah hari kerja terverifikasi. Tarif harian
            tidak diturunkan dari tarif per jam karena jam kerja berbeda per toko.
          </p>
          {initial.tarifPerHari !== null && (
            <p className="text-xs text-muted-foreground">
              Saat ini: Rp {initial.tarifPerHari.toLocaleString("id-ID")}
            </p>
          )}
        </div>
      )}

      {tipe === "BULANAN" && (
        <div className="space-y-1">
          <Label htmlFor={`pokok-${userId}`}>Gaji pokok per bulan (Rp) — wajib</Label>
          <Input
            id={`pokok-${userId}`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 2500000"
            value={nominalGajiPokok}
            onChange={(e) => setNominalGajiPokok(e.target.value)}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Nominal tetap bulanan, tidak bergantung hari hadir. Izin dan
            ketidakhadiran tidak mengurangi nominal ini.
          </p>
          {initial.nominalGajiPokok !== null && (
            <p className="text-xs text-muted-foreground">
              Saat ini: Rp {initial.nominalGajiPokok.toLocaleString("id-ID")}
            </p>
          )}
        </div>
      )}

      <Button type="button" onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Menyimpan..." : "Simpan Gaji"}
      </Button>
    </div>
  );
}
