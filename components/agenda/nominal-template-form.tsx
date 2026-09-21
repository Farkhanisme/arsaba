"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  templateId: string;
  nominalSaatIni: number | null;
};

export function NominalTemplateForm({ templateId, nominalSaatIni }: Props) {
  const router = useRouter();
  const [nominal, setNominal] = useState(
    nominalSaatIni !== null ? String(nominalSaatIni) : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const kirim = async () => {
    const n = Number(nominal);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Nominal harus angka bulat >= 0.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agenda/${templateId}/nominal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nominal: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      const propagated = data.propagatedCount ?? 0;
      toast.success(
        propagated > 0
          ? `Nominal diset + propagate ke ${propagated} turunan.`
          : "Nominal diset."
      );
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
        <Label htmlFor={`nominal-template-${templateId}`}>Nominal (Rp)</Label>
        <Input
          id={`nominal-template-${templateId}`}
          type="text"
          inputMode="numeric"
          placeholder="Contoh: 50000"
          value={nominal}
          onChange={(e) => setNominal(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-xs text-muted-foreground">
          Set nominal akan otomatis diterapkan ke semua turunan yang belum
          punya nominal.
        </p>
      </div>
      <Button type="button" onClick={kirim} disabled={isSubmitting}>
        {isSubmitting ? "Menyimpan..." : "Set Nominal"}
      </Button>
    </div>
  );
}
