"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWaktuWIB, mapsUrl } from "@/lib/absensi";

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

type ShiftAcuan = {
  segmen: "NORMAL" | "PAM";
  jamMulai: string;
  jamSelesai: string;
};

type Props = {
  attendanceId: string;
  log: LogData;
  shiftAcuan?: ShiftAcuan | null;
  // Saran dari server (toleransi 5 menit dikurangi). Admin tetap menginput
  // final; null berarti tidak ada shift acuan sehingga isi manual.
  saranMenitTelat?: number | null;
  // Nilai isPam yang tersimpan di server. WAJIB diteruskan supaya checkbox
  // ter-initialize benar — kalau tidak, approve ulang akan mereset true→false.
  isPamAwal?: boolean;
};

export function LogCard({
  attendanceId,
  log,
  shiftAcuan = null,
  saranMenitTelat = null,
  isPamAwal = false,
}: Props) {
  const router = useRouter();
  const bagian = log.jenis === "MASUK" ? "masuk" : "keluar";
  const isMasuk = log.jenis === "MASUK";

  // Optimistic state — sinkron dari props saat server refresh selesai
  const [status, setStatus] = useState(log.status);
  const [rejectedReason, setRejectedReason] = useState(log.rejectedReason);
  const [optimisticVerifiedBy, setOptimisticVerifiedBy] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  // Pre-fill dengan saran sistem; admin bebas mengubahnya.
  const [menitTelat, setMenitTelat] = useState(
    saranMenitTelat !== null && saranMenitTelat !== undefined ? String(saranMenitTelat) : ""
  );
  // Di-initialize dari nilai server, BUKAN hardcode false — kalau tidak,
  // approve ulang akan mereset penanda PAM yang sudah tersimpan.
  const [isPam, setIsPam] = useState(isPamAwal);

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
            ...(isMasuk && action === "approve"
              ? { menitTelat: Number(menitTelat || 0), isPam }
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
    [attendanceId, bagian, router, menitTelat, isPam, isMasuk]
  );

  const judul = log.jenis === "MASUK" ? "Absen Masuk" : "Absen Keluar";
  const verifiedByName = optimisticVerifiedBy ?? log.verifiedByName;
  const verifiedAtLabel = optimisticVerifiedBy ? "baru saja" : formatWaktuWIB(log.verifiedAt);
  const adaLokasi = log.latitude !== null && log.longitude !== null;

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
          {adaLokasi
            ? `${log.latitude!.toFixed(6)}, ${log.longitude!.toFixed(6)}`
            : "tidak tersedia"}
        </p>
        {adaLokasi && (
          <p>
            <a
              href={mapsUrl(log.latitude!, log.longitude!)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Lihat di Google Maps
            </a>
          </p>
        )}
        {log.keteranganKoreksi && (
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Foto koreksi — foto ini diambil setelah penolakan, BUKAN saat check-in.
            Alasan karyawan: {log.keteranganKoreksi}
          </p>
        )}
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

        {isMasuk && status === "PENDING_VERIFIKASI" && mode === "idle" && (
          <div className="mt-3 space-y-3 border-t pt-3">
            {shiftAcuan ? (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="font-semibold">Jadwal acuan ({shiftAcuan.segmen}):</p>
                <p className="mt-1">
                  {formatWaktuWIB(shiftAcuan.jamMulai)} – {formatWaktuWIB(shiftAcuan.jamSelesai)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Bandingkan dengan waktu absen masuk di atas.
                </p>
              </div>
            ) : (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Tidak ada jadwal shift acuan — isi menit telat manual.
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor={`menit-telat-${log.id}`}>
                Menit telat
                {saranMenitTelat !== null && saranMenitTelat !== undefined
                  ? ` (saran sistem: ${saranMenitTelat} menit)`
                  : ""}
              </Label>
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
              <p className="text-xs text-muted-foreground">
                Saran sudah memperhitungkan toleransi 5 menit. Bisa diubah.
              </p>
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
                if (isMasuk) {
                  const n = Number(menitTelat || 0);
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
