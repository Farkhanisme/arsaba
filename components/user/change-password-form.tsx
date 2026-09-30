"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const { data: session } = useSession();
  const [passwordLama, setPasswordLama] = useState("");
  const [passwordBaru, setPasswordBaru] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!session?.user?.id) {
      toast.error("Anda belum login.");
      return;
    }
    if (passwordLama.length === 0) {
      toast.error("Password lama wajib diisi.");
      return;
    }
    if (passwordBaru.length < 6) {
      toast.error("Password baru minimal 6 karakter.");
      return;
    }
    if (passwordBaru !== konfirmasi) {
      toast.error("Konfirmasi password baru tidak cocok.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordLama, passwordBaru }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Password berhasil diubah.");
      setPasswordLama("");
      setPasswordBaru("");
      setKonfirmasi("");
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-xl bg-card shadow-sm">
      <h3 className="text-base font-semibold">Ubah Password</h3>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="passwordLama">Password Lama</Label>
          <Input
            id="passwordLama"
            type="password"
            value={passwordLama}
            onChange={(e) => setPasswordLama(e.target.value)}
            disabled={isSubmitting}
            placeholder="Masukkan password saat ini"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="passwordBaru">Password Baru</Label>
          <Input
            id="passwordBaru"
            type="password"
            value={passwordBaru}
            onChange={(e) => setPasswordBaru(e.target.value)}
            disabled={isSubmitting}
            placeholder="Minimal 6 karakter"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="konfirmasi">Konfirmasi Password Baru</Label>
          <Input
            id="konfirmasi"
            type="password"
            value={konfirmasi}
            onChange={(e) => setKonfirmasi(e.target.value)}
            disabled={isSubmitting}
            placeholder="Ulangi password baru"
          />
        </div>
      </div>
      <Button type="button" onClick={submit} disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Memproses..." : "Ubah Password"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Anda akan tetap login setelah password diubah.
      </p>
    </div>
  );
}
