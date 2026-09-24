"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatRupiah } from "./shared";

type TokoOption = { id: string; nama: string };

type Props = {
  tokoList: TokoOption[]; // toko aktif selain toko sendiri (dari server page)
  onTerkirim: () => void;
};

const MAX_FILE = 5;

const MIME_OK = ["image/jpeg", "image/png", "image/webp"];

export function SetorForm({ tokoList, onTerkirim }: Props) {
  const [tipeTujuan, setTipeTujuan] = useState<"TOKO" | "PUSAT">("TOKO");
  const [tokoTujuanId, setTokoTujuanId] = useState("");
  const [nominal, setNominal] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const tambahFiles = (list: FileList | null) => {
    if (!list) return;
    const baru = [...files, ...Array.from(list)].slice(0, MAX_FILE);
    if (files.length + list.length > MAX_FILE) {
      toast.error(`Maksimal ${MAX_FILE} foto bukti.`);
    }
    for (const f of Array.from(list)) {
      if (!MIME_OK.includes(f.type)) {
        toast.error(`File '${f.name}' harus gambar (jpeg/png/webp).`);
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`File '${f.name}' melebihi 10 MB.`);
        return;
      }
    }
    setFiles(baru);
    setPreviews(baru.map((f) => URL.createObjectURL(f)));
  };

  const hapusFile = (idx: number) => {
    const url = previews[idx];
    if (url) URL.revokeObjectURL(url);
    setFiles(files.filter((_, i) => i !== idx));
    setPreviews(previews.filter((_, i) => i !== idx));
  };

  const nominalNum = Number(nominal);
  const nominalValid = Number.isInteger(nominalNum) && nominalNum > 0;

  const handleSubmit = async () => {
    if (tipeTujuan === "TOKO" && !tokoTujuanId) {
      toast.error("Pilih toko tujuan.");
      return;
    }
    if (!nominalValid) {
      toast.error("Nominal harus bilangan bulat rupiah lebih dari 0.");
      return;
    }
    if (files.length < 1) {
      toast.error("Lampirkan minimal 1 foto bukti.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("tipeTujuan", tipeTujuan);
      if (tipeTujuan === "TOKO") fd.append("tokoTujuanId", tokoTujuanId);
      fd.append("nominalDisetor", String(nominalNum));
      if (keterangan.trim()) fd.append("keterangan", keterangan.trim());
      for (const f of files) fd.append("foto", f);

      const res = await fetch("/api/setoran", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data && data.error) || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Setoran tercatat. Menunggu konfirmasi penerima.");
      setTipeTujuan("TOKO");
      setTokoTujuanId("");
      setNominal("");
      setKeterangan("");
      for (const u of previews) URL.revokeObjectURL(u);
      setFiles([]);
      setPreviews([]);
      onTerkirim();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setor Uang</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Tujuan</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={tipeTujuan === "TOKO" ? "default" : "outline"}
              size="sm"
              onClick={() => setTipeTujuan("TOKO")}
            >
              Toko Lain
            </Button>
            <Button
              type="button"
              variant={tipeTujuan === "PUSAT" ? "default" : "outline"}
              size="sm"
              onClick={() => setTipeTujuan("PUSAT")}
            >
              Kantor Pusat
            </Button>
          </div>
          {tipeTujuan === "TOKO" && (
            <Select
              value={tokoTujuanId}
              onChange={(e) => setTokoTujuanId(e.target.value)}
            >
              <option value="">— Pilih toko tujuan —</option>
              {tokoList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nama}
                </option>
              ))}
            </Select>
          )}
          {tipeTujuan === "PUSAT" && (
            <p className="text-sm text-muted-foreground">
              Dikonfirmasi oleh Manajer/Admin pusat.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="nominal">Nominal (Rp)</Label>
          <Input
            id="nominal"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="cth. 500000"
            value={nominal}
            onChange={(e) => setNominal(e.target.value)}
          />
          {nominalValid && (
            <p className="text-sm text-muted-foreground">{formatRupiah(nominalNum)}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="keterangan">Keterangan (opsional, maks 200)</Label>
          <Input
            id="keterangan"
            type="text"
            maxLength={200}
            placeholder="cth. Omset shift pagi"
            value={keterangan}
            onChange={(e) => setKeterangan(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>Foto bukti (1–{MAX_FILE})</Label>
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              tambahFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative">
                  <img
                    src={url}
                    alt={`Bukti ${i + 1}`}
                    className="h-20 w-20 rounded-md border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => hapusFile(i)}
                    className="absolute -right-2 -top-2 rounded-full bg-destructive px-1.5 text-xs text-white"
                    aria-label={`Hapus foto ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Mengirim..." : "Kirim Setoran"}
        </Button>
      </CardContent>
    </Card>
  );
}
