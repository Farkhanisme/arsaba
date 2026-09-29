"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  attendanceId: string;
  /** ISO dari `Attendance.absenMasuk` — dipakai untuk batas bawah & pratinjau. */
  absenMasuk?: string;
  /** Tipe gaji karyawan; hanya `JAM` yang punya fitur Koreksi Jam. */
  tipeGaji?: string | null;
};

/** Batas atas selisih, cerminan `MAKS_SELISIH_MENIT` di route. */
const MAKS_JAM = 24;

/**
 * Format `Date` -> nilai untuk `<input type="datetime-local">`.
 *
 * WAJIB zona lokal: `datetime-local` tidak menyimpan timezone, dan `new Date(x)`
 * mem-parsenya sebagai waktu lokal. Kalau attrs `min`/`max` diisi dari
 * `toISOString()` (UTC), batasnya bergeser 7 jam di WIB dan input yang sah
 * ikut tertolak.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatDurasi(menit: number): string {
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return m === 0 ? `${j} jam` : `${j} jam ${m} menit`;
}

export function OverrideKeluarForm({
  attendanceId,
  absenMasuk,
  tipeGaji,
}: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [waktu, setWaktu] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Batas atas (sekarang) & bawah (waktu masuk) untuk input datetime-local.
  // `datetime-local` memakai format "YYYY-MM-DDTHH:mm" dalam zona LOKAL, jadi
  // batas harus diformat lokal juga — bukan `.toISOString()` yang UTC.
  const maksWaktu = useMemo(() => toLocalInputValue(new Date()), []);
  const minWaktu = useMemo(
    () => (absenMasuk ? toLocalInputValue(new Date(absenMasuk)) : undefined),
    [absenMasuk]
  );

  // Pratinjau durasi hasil override, supaya admin tahu efeknya sebelum menyimpan.
  const pratinjau = useMemo(() => {
    if (!waktu || !absenMasuk) return null;
    const masuk = new Date(absenMasuk).getTime();
    const keluar = new Date(waktu).getTime();
    if (Number.isNaN(keluar) || Number.isNaN(masuk)) return null;
    const menit = Math.floor((keluar - masuk) / 60_000);
    if (menit < 0) return { menit, valid: false, alasan: "lebih awal dari waktu masuk" };
    if (menit > MAKS_JAM * 60) {
      return { menit, valid: false, alasan: `melebihi batas ${MAKS_JAM} jam` };
    }
    return { menit, valid: true, alasan: null };
  }, [waktu, absenMasuk]);

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
                min={minWaktu}
                max={maksWaktu}
                onChange={(e) => setWaktu(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            {pratinjau && (
              <p
                className={`text-xs ${
                  pratinjau.valid
                    ? "text-muted-foreground"
                    : "text-destructive"
                }`}
              >
                {pratinjau.valid
                  ? `Durasi kerja akan menjadi ${formatDurasi(pratinjau.menit)}.`
                  : `Tidak valid: waktu keluar ${pratinjau.alasan}.`}
                {pratinjau.valid && tipeGaji === "JAM" && (
                  <>
                    {" "}
                    Kalau tujuannya menambah jam kerjadi atas, pakai
                    fitur Koreksi Jam di halaman payslip — supaya jam tambahan
                    tercatat sebagai keputusan Manajer, bukan hasil hitungan
                    absensi.
                  </>
                )}
              </p>
            )}
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
