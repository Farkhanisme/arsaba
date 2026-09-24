"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Mode = "check-in" | "check-out";
type CameraFacing = "user" | "environment";
type LocationStatus = "idle" | "loading" | "success" | "error";

type Props = {
  mode?: Mode;
};

export function AbsensiForm({ mode = "check-in" }: Props) {
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facing, setFacing] = useState<CameraFacing>("user");
  const [kameraSiap, setKameraSiap] = useState(false);
  const [kameraError, setKameraError] = useState<string | null>(null);

  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [lokasiStatus, setLokasiStatus] = useState<LocationStatus>("idle");
  const [lokasiPesan, setLokasiPesan] = useState<string | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Start / switch camera
  useEffect(() => {
    let cancelled = false;
    setKameraSiap(false);
    setKameraError(null);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setKameraError("Browser ini tidak mendukung akses kamera.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setKameraSiap(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.name : "";
        if (msg === "NotAllowedError") {
          setKameraError("Izin kamera ditolak. Aktifkan izin kamera di browser lalu muat ulang halaman.");
        } else if (msg === "NotFoundError") {
          setKameraError("Tidak ada kamera yang terdeteksi di perangkat ini.");
        } else if (msg === "NotReadableError") {
          setKameraError("Kamera sedang dipakai aplikasi lain. Tutup aplikasi lain lalu coba lagi.");
        } else {
          setKameraError("Gagal mengakses kamera.");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facing]);

  // Cleanup preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleSwitchKamera = useCallback(() => {
    setFacing((f) => (f === "user" ? "environment" : "user"));
  }, []);

  const handleAmbilFoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
    );
    if (!blob) {
      toast.error("Gagal memproses foto dari kamera.");
      return;
    }
    const file = new File([blob], `absensi-${Date.now()}.jpg`, { type: "image/jpeg" });
    setCapturedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, []);

  const handleFotoUlang = useCallback(() => {
    setCapturedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }, [previewUrl]);

  const handleAmbilLokasi = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLokasiStatus("error");
      setLokasiPesan("Browser ini tidak mendukung geolokasi.");
      return;
    }
    setLokasiStatus("loading");
    setLokasiPesan("Mengambil lokasi...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setLokasiStatus("success");
        setLokasiPesan(null);
      },
      (err) => {
        setLokasiStatus("error");
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setLokasiPesan("Izin lokasi ditolak. Aktifkan izin lokasi di browser lalu coba lagi.");
            break;
          case err.POSITION_UNAVAILABLE:
            setLokasiPesan("Lokasi tidak tersedia saat ini.");
            break;
          case err.TIMEOUT:
            setLokasiPesan("Permintaan lokasi timeout. Coba lagi.");
            break;
          default:
            setLokasiPesan("Gagal mengambil lokasi.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!capturedFile) {
      toast.error("Ambil foto terlebih dahulu.");
      return;
    }
    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("foto", capturedFile);
      if (latitude !== null) fd.append("latitude", String(latitude));
      if (longitude !== null) fd.append("longitude", String(longitude));

      const endpoint = mode === "check-in" ? "/api/absensi" : "/api/absensi/checkout";
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const pesan = (data && data.error) || `Gagal (HTTP ${res.status})`;
        toast.error(pesan);
        return;
      }

      toast.success(mode === "check-in" ? "Check-in berhasil." : "Check-out berhasil.");
      setCapturedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setLatitude(null);
      setLongitude(null);
      setLokasiStatus("idle");
      setLokasiPesan(null);
      router.refresh();
    } catch (err) {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  }, [capturedFile, latitude, longitude, mode, previewUrl, router]);

  const judul = mode === "check-in" ? "Absen Masuk" : "Absen Keluar";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{judul}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1">
          <Label>Foto {mode === "check-in" ? "Masuk" : "Keluar"}</Label>

          <div className={`relative mx-auto w-full max-w-xl overflow-hidden rounded-md border bg-black ${capturedFile ? "hidden" : ""}`}>
            <video
              ref={videoRef}
              playsInline
              muted
              className="block h-auto w-full"
            />
            {!kameraSiap && !kameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
                Menyalakan kamera...
              </div>
            )}
          </div>

          {!capturedFile && kameraError && (
            <p className="text-sm text-destructive">{kameraError}</p>
          )}

          {!capturedFile && (
            <div className="flex gap-2">
              <Button type="button" onClick={handleAmbilFoto} disabled={!kameraSiap}>
                Ambil Foto
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSwitchKamera}
                disabled={!kameraSiap}
              >
                Ganti Kamera
              </Button>
            </div>
          )}

          {capturedFile && previewUrl && (
            <>
              <img
                src={previewUrl}
                alt="Preview foto absensi"
                className="max-h-64 rounded-md border object-contain"
              />
              <Button type="button" variant="outline" onClick={handleFotoUlang}>
                Foto Ulang
              </Button>
            </>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="space-y-1">
          <Label>Lokasi (opsional)</Label>
          <Button type="button" variant="outline" onClick={handleAmbilLokasi} disabled={lokasiStatus === "loading"}>
            {lokasiStatus === "loading" ? "Mengambil..." : "Ambil Lokasi"}
          </Button>
          {lokasiStatus === "success" && latitude !== null && longitude !== null && (
            <p className="text-sm text-muted-foreground">
              Lat: {latitude.toFixed(6)}, Long: {longitude.toFixed(6)}
            </p>
          )}
          {lokasiStatus === "error" && lokasiPesan && (
            <p className="text-sm text-destructive">{lokasiPesan}</p>
          )}
        </div>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!capturedFile || isSubmitting}
        >
          {isSubmitting ? "Mengirim..." : `Kirim ${judul}`}
        </Button>
      </CardContent>
    </Card>
  );
}
