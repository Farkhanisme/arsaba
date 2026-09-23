"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HariKerjaPicker } from "./hari-kerja-picker";
import { TimePicker } from "@/components/ui/time-picker";

type Props =
  | {
      mode: "create";
      storeId: string;
    }
  | {
      mode: "edit";
      templateId: string;
      initial: {
        nama: string;
        jamMulai: string; // "HH:mm"
        jamSelesai: string; // "HH:mm"
        lintasHari: boolean;
        hariKerja: number[];
        aktif: boolean;
      };
    };

function menitToTime(menit: number): string {
  const jam = Math.floor(menit / 60);
  const m = menit % 60;
  return `${String(jam).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMenit(time: string): number {
  const parts = time.split(":");
  const jam = Number(parts[0]);
  const menit = Number(parts[1]);
  if (Number.isNaN(jam) || Number.isNaN(menit)) return 0;
  return jam * 60 + menit;
}

export function ShiftTemplateForm(props: Props) {
  const router = useRouter();
  const isCreate = props.mode === "create";

  const [nama, setNama] = useState(isCreate ? "" : props.initial.nama);
  const [jamMulai, setJamMulai] = useState(isCreate ? "07:00" : props.initial.jamMulai);
  const [jamSelesai, setJamSelesai] = useState(isCreate ? "16:00" : props.initial.jamSelesai);
  const [lintasHari, setLintasHari] = useState(isCreate ? false : props.initial.lintasHari);
  const [hariKerja, setHariKerja] = useState<number[]>(isCreate ? [] : props.initial.hariKerja);
  const [aktif, setAktif] = useState(isCreate ? true : props.initial.aktif);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-set lintasHari saat jam berubah
  const handleJamMulaiChange = (value: string) => {
    setJamMulai(value);
    if (!isCreate) return; // edit mode: biarkan manual
    const mulai = timeToMenit(value);
    const selesai = timeToMenit(jamSelesai);
    setLintasHari(selesai < mulai);
  };

  const handleJamSelesaiChange = (value: string) => {
    setJamSelesai(value);
    if (!isCreate) return;
    const mulai = timeToMenit(jamMulai);
    const selesai = timeToMenit(value);
    setLintasHari(selesai < mulai);
  };

  const submit = async () => {
    if (nama.trim().length < 2) {
      toast.error("Nama template minimal 2 karakter.");
      return;
    }
    if (jamMulai === jamSelesai && !lintasHari) {
      toast.error("Jam mulai dan selesai sama tapi tidak lintas hari. Centang 'Lintas hari' atau ubah jam selesai.");
      return;
    }
    if (hariKerja.length === 0 && !lintasHari) {
      // SEMUA hari boleh kosong, tapi custom harus ada minimal 1
      // hariKerja kosong = SEMUA, jadi valid
    }

    setIsSubmitting(true);
    try {
      const body = {
        nama: nama.trim(),
        jamMulaiMenit: timeToMenit(jamMulai),
        jamSelesaiMenit: timeToMenit(jamSelesai),
        lintasHari,
        hariKerja,
        aktif,
      };

      const url = isCreate ? `/api/store/${props.storeId}/shift-template` : `/api/shift-template/${props.templateId}`;
      const method = isCreate ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success(isCreate ? "Template shift dibuat." : "Template shift diubah.");
      router.push(`/master/toko/${isCreate ? props.storeId : (await fetch(`/api/shift-template/${props.templateId}`).then(r => r.json())).storeId}/shift-template`);
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Hapus template ini? Tindakan tidak bisa dibatalkan.")) return;
    if (isCreate) return;

    try {
      const res = await fetch(`/api/shift-template/${props.templateId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Template shift dihapus.");
      // Redirect ke list, perlu storeId - ambil dari API atau pass via props
      router.push("/master/toko"); // fallback
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="template-nama">Nama Template</Label>
        <Input
          id="template-nama"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Contoh: Pagi Weekday"
          disabled={isSubmitting}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <TimePicker
            id="jam-mulai"
            label="Jam Mulai"
            value={jamMulai}
            onChange={handleJamMulaiChange}
            disabled={isSubmitting}
            required
          />
        </div>
        <div className="space-y-1">
          <TimePicker
            id="jam-selesai"
            label="Jam Selesai"
            value={jamSelesai}
            onChange={handleJamSelesaiChange}
            disabled={isSubmitting}
            required
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="lintas-hari"
          checked={lintasHari}
          onChange={(e) => setLintasHari(e.target.checked)}
          disabled={isSubmitting}
        />
        <Label htmlFor="lintas-hari" className="text-sm cursor-pointer mb-0">
          Lintas hari (selesai keesokan harinya)
        </Label>
        {lintasHari && (
          <span className="text-xs text-muted-foreground ml-2">
            Contoh: 18:00 – 06:00 (shift malam)
          </span>
        )}
      </div>

      <HariKerjaPicker
        value={hariKerja}
        onChange={setHariKerja}
        disabled={isSubmitting}
        label="Pola Hari Kerja"
      />

      {!isCreate && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={aktif}
            onChange={(e) => setAktif(e.target.checked)}
            disabled={isSubmitting}
          />
          Template aktif
        </label>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={submit} disabled={isSubmitting}>
          {isSubmitting ? "Menyimpan..." : isCreate ? "Simpan Template" : "Simpan Perubahan"}
        </Button>
        {!isCreate && (
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
            Hapus
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Batal
        </Button>
      </div>
    </div>
  );
}