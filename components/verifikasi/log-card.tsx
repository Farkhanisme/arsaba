"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

type LogData = {
  id: string;
  jenis: "MASUK" | "KELUAR";
  status: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK";
  absenServerPada: string;
  latitude: number | null;
  longitude: number | null;
  fotoFileId: string | null;
  keteranganKoreksi: string | null;
  rejectedReason: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  isOverride: boolean;
};

type JadwalAcuan = {
  segmen: "NORMAL" | "PAM";
  jamMulai: string;
  jamSelesai: string;
};

type Props = {
  attendanceId: string;
  log: LogData;
  jadwalAcuan?: JadwalAcuan[];
};

function formatWaktuWIB(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mi = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} WIB`;
}

export function LogCard({ attendanceId, log, jadwalAcuan = [] }: Props) {
  const router = useRouter();
  const bagian = log.jenis === "MASUK" ? "masuk" : "keluar";

  // Optimistic state — sinkron dari props saat server refresh selesai
  const [status, setStatus] = useState(log.status);
  const [rejectedReason, setRejectedReason] = useState(log.rejectedReason);
  const [optimisticVerifiedBy, setOptimisticVerifiedBy] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [menitTelat, setMenitTelat] = useState("0");
  const [isPam, setIsPam] = useState(false);

  const kirim = useCallback(
    async (action: "approve" | "reject", reasonText?: string) => {
      setIsSubmitting(true);
      try {
        const res = await fetch(`/api/absensi/${attendanceId}/verify`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bagian,
            action,
            ...(bagian === "masuk" && action === "approve"
              ? { menitTelat: Number(menitTelat), isPam }
              : {}),
            ...(action === "reject" ? { reason: reasonText } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const pesan = (data && data.error) || `Gagal (HTTP ${res.status})`;
          toast.error(pesan);
          return;
        }
        // Optimistic: update instan sebelum server refresh
        setStatus(action === "approve" ? "DIVERIFIKASI" : "DITOLAK");
        setRejectedReason(action === "reject" ? (reasonText ?? null) : null);
        setOptimisticVerifiedBy("Anda (baru saja)");
        setMode("idle");
        setReason("");
        setMenitTelat("0");
        setIsPam(false);
        toast.success(
          action === "approve"
            ? `Absen ${bagian} disetujui.`
            : `Absen ${bagian} ditolak.`
        );
        // Sinkron di belakang
        router.refresh();
      } catch {
        toast.error("Terjadi kesalahan jaringan.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [attendanceId, bagian, router, menitTelat, isPam]
  );

  const judul = log.jenis === "MASUK" ? "Absen Masuk" : "Absen Keluar";
  const verifiedByName = optimisticVerifiedBy ?? log.verifiedByName;
  const verifiedAtLabel = optimisticVerifiedBy ? "baru saja" : formatWaktuWIB(log.verifiedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {judul} — {status}
          {log.isOverride && " (Override)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Waktu server: {formatWaktuWIB(log.absenServerPada)}</p>
        <p>
          Lokasi:{" "}
          {log.latitude !== null && log.longitude !== null
            ? `${log.latitude.toFixed(6)}, ${log.longitude.toFixed(6)}`
            : "tidak tersedia"}
        </p>
        {log.keteranganKoreksi && <p>Keterangan koreksi: {log.keteranganKoreksi}</p>}
        {rejectedReason && <p className="text-destructive">Alasan ditolak: {rejectedReason}</p>}
        {verifiedByName && (
          <p>
            Diverifikasi oleh {verifiedByName} pada {verifiedAtLabel}
          </p>
        )}
        {log.fotoFileId ? (
          <div className="mt-2">
            <img
              src={`/api/telegram/file/${encodeURIComponent(log.fotoFileId)}`}
              alt={`Foto absen ${log.jenis.toLowerCase()}`}
              className="max-h-96 rounded-md border object-contain"
            />
          </div>
        ) : (
          <p className="text-muted-foreground">Tidak ada foto.</p>
        )}

        {log.jenis === "MASUK" && status === "PENDING_VERIFIKASI" && mode === "idle" && (
          <div className="mt-3 space-y-3 border-t pt-3">
            {jadwalAcuan.length > 0 && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="font-semibold">Jadwal acuan:</p>
                <ul className="mt-1 space-y-0.5">
                  {jadwalAcuan.map((j, i) => (
                    <li key={i}>
                      {j.segmen}: {formatWaktuWIB(j.jamMulai)} – {formatWaktuWIB(j.jamSelesai)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  Bandingkan dengan waktu absen masuk di atas untuk menentukan menit telat.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor={`menit-telat-${log.id}`}>Menit telat (0 jika tidak telat)</Label>
              <Input
                id={`menit-telat-${log.id}`}
                type="number"
                min={0}
                max={1440}
                step={1}
                value={menitTelat}
                onChange={(e) => setMenitTelat(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPam}
                onChange={(e) => setIsPam(e.target.checked)}
                disabled={isSubmitting}
              />
              Tandai absen ini sebagai PAM (penugasan backup)
            </label>
          </div>
        )}

        {status === "PENDING_VERIFIKASI" && mode === "idle" && (
          <div className="mt-3 flex gap-2 border-t pt-3">
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                if (bagian === "masuk") {
                  const n = Number(menitTelat);
                  if (!Number.isInteger(n) || n < 0 || n > 1440) {
                    toast.error("Menit telat harus angka bulat 0–1440.");
                    return;
                  }
                }
                kirim("approve");
              }}
            >
              {isSubmitting ? "Mengirim..." : `Setujui Absen ${bagian}`}
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

        {status === "PENDING_VERIFIKASI" && mode === "reject" && (
          <div className="mt-3 space-y-1 border-t pt-3">
            <Label htmlFor={`reason-${log.id}`}>Alasan penolakan</Label>
            <Input
              id={`reason-${log.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Foto tidak jelas"
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
      </CardContent>
    </Card>
  );
}
