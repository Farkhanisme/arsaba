"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showProgressToast, completeProgressToast, showSuccessWithAction } from "@/components/ui/action-toast";

export default function PayrollGenerateForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [periode, setPeriode] = useState(() => {
    // Default to current month in YYYY-MM format
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });

  const submit = async () => {
    if (!periode) {
      toast.error("Pilih periode terlebih dahulu.");
      return;
    }

    setIsSubmitting(true);
    const progressToast = showProgressToast({ message: "Memproses generate payroll...", isLoading: true });
    
    try {
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        completeProgressToast(false, data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      completeProgressToast(true, `Generate selesai: ${data.totalGenerated} diproses, ${data.totalSkipped} di-skip`);
      // Show success with action to view payroll
      showSuccessWithAction(
        `Generate selesai: ${data.totalGenerated} diproses, ${data.totalSkipped} di-skip`,
        "Lihat Payroll",
        () => router.push("/manajer/payroll"),
        10000
      );
    } catch {
      completeProgressToast(false, "Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="space-y-1 w-full sm:w-auto">
        <Label htmlFor="periode-generate" className="hidden sm:block">
          Periode (YYYY-MM)
        </Label>
        <Input
          id="periode-generate"
          type="month"
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          disabled={isSubmitting}
          className="w-full sm:w-[180px]"
        />
      </div>
      <Button onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Memproses..." : "Generate Payroll"}
      </Button>
    </div>
  );
}