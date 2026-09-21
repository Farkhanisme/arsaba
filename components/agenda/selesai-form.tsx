"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  agendaId: string;
};

export function SelesaiForm({ agendaId }: Props) {
  const router = useRouter();
  const [fotoBefore, setFotoBefore] = useState<File | null>(null);
  const [fotoAfter, setFotoAfter] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setIsSubmitting(true);
    try {
      const fd = new FormData();
      if (fotoBefore) fd.append("fotoBefore", fotoBefore);
      if (fotoAfter) fd.append("fotoAfter", fotoAfter);

      const res = await fetch(`/api/agenda/${agendaId}/selesai`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Agenda ditandai selesai. Menunggu verifikasi.");
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
    <div className="space-y-4 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        Tandai agenda ini sebagai selesai. Foto bukti opsional.
      </p>

      <div className="space-y-1">
        <Label htmlFor={`selesai-before-${agendaId}`}>
          Foto sebelum (opsional)
        </Label>
        <Input
          id={`selesai-before-${agendaId}`}
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
        <Label htmlFor={`selesai-after-${agendaId}`}>
          Foto sesudah (opsional)
        </Label>
        <Input
          id={`selesai-after-${agendaId}`}
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
        {isSubmitting ? "Mengirim..." : "Tandai Selesai"}
      </Button>
    </div>
  );
}
