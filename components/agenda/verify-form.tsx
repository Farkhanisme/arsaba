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

export function VerifyForm({ agendaId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const kirim = async (action: "approve" | "reject", reasonText?: string) => {
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "reject") {
        body.reason = reasonText;
      }

      const res = await fetch(`/api/agenda/${agendaId}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success(
        action === "approve" ? "Agenda disetujui." : "Agenda ditolak."
      );
      router.push("/verifikasi/agenda");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Nominal bonus akan diisi oleh Manajer setelah agenda disetujui.
      </p>

      {mode === "idle" && (
        <div className="flex gap-2 border-t pt-4">
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => kirim("approve")}
          >
            {isSubmitting ? "Mengirim..." : "Setujui"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting}
            onClick={() => setMode("reject")}
          >
            Tolak
          </Button>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="reason">Alasan penolakan</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Bukti tidak jelas"
            disabled={isSubmitting}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting || reason.trim().length < 3}
              onClick={() => kirim("reject", reason.trim())}
            >
              {isSubmitting ? "Mengirim..." : "Konfirmasi Tolak"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setMode("idle");
                setReason("");
              }}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
