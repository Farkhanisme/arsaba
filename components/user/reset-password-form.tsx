"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  userId: string;
};

export function ResetPasswordForm({ userId }: Props) {
  const [passwordBaru, setPasswordBaru] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (passwordBaru.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/user/${userId}/reset-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordBaru }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Password berhasil direset.");
      setPasswordBaru("");
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="passwordBaru">Password baru (min 6)</Label>
        <Input
          id="passwordBaru"
          type="password"
          value={passwordBaru}
          onChange={(e) => setPasswordBaru(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-xs text-muted-foreground">
          Password lama akan diganti. Beritahu user password baru ini.
        </p>
      </div>
      <Button type="button" onClick={submit} disabled={isSubmitting}>
        {isSubmitting ? "Memproses..." : "Reset Password"}
      </Button>
    </div>
  );
}
