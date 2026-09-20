"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  attendanceId: string;
};

export function OverrideKeluarForm({ attendanceId }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [waktu, setWaktu] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const kirim = useCallback(async () => {
    if (!waktu) {
      toast.error("Isi waktu keluar terlebih dahulu.");
      return;
    }
    if (keterangan.trim().length < 3) {
      toast.error("Keterangan minimal 3 karakter.");
      return;
    }

    const iso = new Date(waktu).toISOString();

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/absensi/${attendanceId}/override-keluar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absenKeluar: iso, keterangan: keterangan.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const pesan = (data && data.error) || `Gagal (HTTP ${res.status})`;
        toast.error(pesan);
        return;
      }
      toast.success("Absen keluar berhasil diisi manual.");
      setIsOpen(false);
      setWaktu("");
      setKeterangan("");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  }, [attendanceId, keterangan, router, waktu]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Absen Keluar — belum ada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Karyawan belum melakukan check-out. Isi absen keluar secara manual jika karyawan lupa,
          atau tunggu karyawan melakukan check-out sendiri.
        </p>

        {!isOpen && (
          <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
            Isi Absen Keluar Manual
          </Button>
        )}

        {isOpen && (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor={`waktu-${attendanceId}`}>Waktu keluar</Label>
              <Input
                id={`waktu-${attendanceId}`}
                type="datetime-local"
                value={waktu}
                onChange={(e) => setWaktu(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`keterangan-${attendanceId}`}>Keterangan</Label>
              <Input
                id={`keterangan-${attendanceId}`}
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Contoh: Karyawan lupa check-out, dikonfirmasi via telepon"
                disabled={isSubmitting}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={isSubmitting || !waktu || keterangan.trim().length < 3}
                onClick={kirim}
              >
                {isSubmitting ? "Mengirim..." : "Simpan Absen Keluar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setIsOpen(false);
                  setWaktu("");
                  setKeterangan("");
                }}
              >
                Batal
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
