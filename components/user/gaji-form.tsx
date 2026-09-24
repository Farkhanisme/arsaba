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
    nominalGajiPokok: number | null;
  };
};

const TIPE_OPTIONS: TipePerhitunganGaji[] = ["HARIAN", "BULANAN", "JAM"];

export function GajiForm({ userId, initial }: Props) {
  const router = useRouter();
  const [tipe, setTipe] = useState<TipePerhitunganGaji | "">(
    initial.tipePerhitunganGaji ?? ""
  );
  const [tarifPerJam, setTarifPerJam] = useState(
    initial.tarifPerJam !== null ? String(initial.tarifPerJam) : ""
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
    if (tipe === "JAM" && tarifPerJam.trim() === "") {
      toast.error("Tipe JAM wajib mengisi tarif per jam.");
      return;
    }

    const body: Record<string, unknown> = {
      tipePerhitunganGaji: tipe,
    };

    if (tipe === "JAM") {
      const v = Number(tarifPerJam);
      if (!Number.isInteger(v) || v < 0) {
        toast.error("Tarif per jam harus angka bulat >= 0.");
        return;
      }
      body.tarifPerJam = v;
    }

    if (nominalGajiPokok.trim() !== "") {
      const v = Number(nominalGajiPokok);
      if (!Number.isInteger(v) || v < 0) {
        toast.error("Gaji pokok harus angka bulat >= 0.");
        return;
      }
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
          <Label htmlFor={`tarif-${userId}`}>Tarif per jam (Rp)</Label>
          <Input
            id={`tarif-${userId}`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 15000"
            value={tarifPerJam}
            onChange={(e) => setTarifPerJam(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`pokok-${userId}`}>
          Gaji pokok (Rp) — opsional, biarkan kosong jika tidak diubah
        </Label>
        <Input
          id={`pokok-${userId}`}
          type="text"
          inputMode="numeric"
          placeholder="Contoh: 2500000"
          value={nominalGajiPokok}
          onChange={(e) => setNominalGajiPokok(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <Button type="button" onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Menyimpan..." : "Simpan Gaji"}
      </Button>
    </div>
  );
}
