"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LaporMandiriForm() {
  const router = useRouter();
  const [judul, setJudul] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  const [fotoBefore, setFotoBefore] = useState<File | null>(null);
  const [fotoAfter, setFotoAfter] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (judul.trim().length < 3) {
      toast.error("Judul minimal 3 karakter.");
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("judul", judul.trim());
      if (deskripsi.trim().length > 0) {
        fd.append("deskripsi", deskripsi.trim());
      }
      if (fotoBefore) fd.append("fotoBefore", fotoBefore);
      if (fotoAfter) fd.append("fotoAfter", fotoAfter);

      const res = await fetch("/api/agenda/mandiri", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Laporan agenda mandiri terkirim. Menunggu verifikasi.");
      setJudul("");
      setDeskripsi("");
      setFotoBefore(null);
      setFotoAfter(null);
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="mandiri-judul">Judul kegiatan</Label>
        <Input
          id="mandiri-judul"
          placeholder="Contoh: Bantu angkat barang di gudang"
          value={judul}
          onChange={(e) => setJudul(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="mandiri-deskripsi">Deskripsi (opsional)</Label>
        <textarea
          id="mandiri-deskripsi"
          placeholder="Keterangan tambahan..."
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={deskripsi}
          onChange={(e) => setDeskripsi(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="mandiri-foto-before">
          Foto sebelum (opsional)
        </Label>
        <Input
          id="mandiri-foto-before"
          type="file"
          accept="image/*"
          onChange={(e) => setFotoBefore(e.target.files?.[0] ?? null)}
          disabled={isSubmitting}
        />
        {fotoBefore && (
          <p className="text-xs text-muted-foreground">{fotoBefore.name}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="mandiri-foto-after">Foto sesudah (opsional)</Label>
        <Input
          id="mandiri-foto-after"
          type="file"
          accept="image/*"
          onChange={(e) => setFotoAfter(e.target.files?.[0] ?? null)}
          disabled={isSubmitting}
        />
        {fotoAfter && (
          <p className="text-xs text-muted-foreground">{fotoAfter.name}</p>
        )}
      </div>

      <Button type="button" onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Mengirim..." : "Kirim Laporan"}
      </Button>
    </div>
  );
}
