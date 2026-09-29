"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { showUndoToast } from "@/components/ui/action-toast";

type PayrollData = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    kode: string;
    nama: string;
    role: string;
    tipePerhitunganGaji: string | null;
    tarifPerJam: number | null;
    storeId: string | null;
    store: { id: string; nama: string } | null;
  };
  periode: string;
  gajiPokok: number;
  totalHariKerja: number | null;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  bonusManual: number;
  potonganManual: number;
  bonusPerforma: number;
  keteranganBonusPerforma: string | null;
  totalGaji: number;
  status: string;
  lockedAt: string | null;
  lockedById: string | null;
  revisiKe: number;
  revisiAlasan: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

function formatTanggalLokal(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    return format(date, "d MMMM yyyy, HH:mm", { locale: id });
  } catch {
    return dateStr;
  }
}

const MAX_AMOUNT = 100_000_000;

type HariDetail = {
  id: string;
  tanggalShift: string;
  absenMasuk: string | null;
  absenKeluar: string | null;
  totalMenitKerja: number;
  totalMenitManual: number | null;
  koreksiJamAlasan: string | null;
  koreksiJamPada: string | null;
  isPam: boolean;
};

type Props = {
  initialData: PayrollData;
  rincianHari: HariDetail[];
};

function jamMenit(menit: number): string {
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return m === 0 ? `${j} jam` : `${j} jam ${m} mnt`;
}

export default function PayrollDetailClient({ initialData, rincianHari }: Props) {
  const router = useRouter();
  const [data, setData] = useState<PayrollData>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  // Mekanisme revisi §7.1b — hanya relevan saat payroll LOCKED.
  const [revisiAlasan, setRevisiAlasan] = useState("");
  const [isMerevisi, setIsMerevisi] = useState(false);
  const [showRevisiForm, setShowRevisiForm] = useState(false);

  const MIN_ALASAN_REVISI = 10;

  // Koreksi jam manual (P0-7) — hanya untuk tipe JAM.
  const [hari, setHari] = useState<HariDetail[]>(rincianHari);
  const [koreksiUntuk, setKoreksiUntuk] = useState<string | null>(null);
  const [presetJam, setPresetJam] = useState("8");
  const [koreksiAlasan, setKoreksiAlasan] = useState("");
  const [isMengoreksi, setIsMengoreksi] = useState(false);
  const MIN_ALASAN_KOREKSI = 5;

  const tarif = data.employee.tarifPerJam ?? 0;
  const isTipeJam = data.employee.tipePerhitunganGaji === "JAM";

  const bukaKoreksi = (h: HariDetail) => {
    setKoreksiUntuk(h.id);
    // Preset awal = pembulatan ke atas ke jam penuh terdekat.
    const menitEfek = h.totalMenitManual ?? h.totalMenitKerja;
    setPresetJam(String(Math.max(1, Math.round(menitEfek / 60))));
    setKoreksiAlasan("");
  };

  const kirimKoreksi = async (reset: boolean) => {
    if (!koreksiUntuk) return;
    if (koreksiAlasan.trim().length < MIN_ALASAN_KOREKSI) {
      toast.error(`Alasan wajib diisi, minimal ${MIN_ALASAN_KOREKSI} karakter.`);
      return;
    }
    const target = hari.find((h) => h.id === koreksiUntuk);
    if (!target) return;

    const totalMenitManual = reset ? null : Number(presetJam) * 60;
    if (!reset && (!Number.isInteger(Number(presetJam)) || Number(presetJam) < 0 || Number(presetJam) > 24)) {
      toast.error("Jam harus 0-24.");
      return;
    }

    const sebelumJam = Math.floor((target.totalMenitManual ?? target.totalMenitKerja) / 60);
    const sesudahJam = reset
      ? Math.floor(target.totalMenitKerja / 60)
      : Number(presetJam);
    const deltaRupiah = (sesudahJam - sebelumJam) * tarif;

    const pesan = reset
      ? `Batalkan koreksi hari ${target.tanggalShift}? Kembali ke ${jamMenit(target.totalMenitKerja)}.`
      : `Koreksi ${target.tanggalShift} menjadi ${presetJam} jam?\n` +
        `Dampak: ${deltaRupiah >= 0 ? "+" : ""}${formatRupiah(deltaRupiah)} pada payroll ini.`;
    if (!window.confirm(pesan)) return;

    setIsMengoreksi(true);
    try {
      const res = await fetch(`/api/absensi/${koreksiUntuk}/koreksi-jam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalMenitManual, alasan: koreksiAlasan.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      setHari((prev) =>
        prev.map((h) =>
          h.id === koreksiUntuk
            ? {
                ...h,
                totalMenitManual: json.totalMenitManual ?? null,
                koreksiJamAlasan: koreksiAlasan.trim(),
                koreksiJamPada: new Date().toISOString(),
              }
            : h
        )
      );
      toast.success(
        `Jam ${target.tanggalShift} dikoreksi menjadi ${json.jamDibayar} jam.`
      );
      setKoreksiUntuk(null);
      setKoreksiAlasan("");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsMengoreksi(false);
    }
  };

  const kirimRevisi = async () => {
    if (revisiAlasan.trim().length < MIN_ALASAN_REVISI) {
      toast.error(`Alasan revisi wajib diisi, minimal ${MIN_ALASAN_REVISI} karakter.`);
      return;
    }
    if (
      !window.confirm(
        `Buka payroll ini untuk revisi?\n\nAlasan: ${revisiAlasan.trim()}\n\n` +
          "Setelah dibuka, Anda bisa mengubah field dan mengunci lagi. Jejak revisi akan tercatat."
      )
    ) {
      return;
    }

    setIsMerevisi(true);
    try {
      const res = await fetch(`/api/payroll/${data.id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan: revisiAlasan.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success(`Payroll dibuka untuk revisi (ke-${json.revisiKe}).`);
      setRevisiAlasan("");
      setShowRevisiForm(false);
      const fresh = await fetch(`/api/payroll/${data.id}`, { cache: "no-store" });
      if (fresh.ok) setData(await fresh.json());
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsMerevisi(false);
    }
  };

  const [bonusManual, setBonusManual] = useState(String(data.bonusManual));
  const [potonganManual, setPotonganManual] = useState(String(data.potonganManual));
  const [bonusPerforma, setBonusPerforma] = useState(String(data.bonusPerforma));
  const [keteranganBonusPerforma, setKeteranganBonusPerforma] = useState(
    data.keteranganBonusPerforma ?? ""
  );

  const isLocked = data.status === "LOCKED";

  const validateAmount = (value: string, fieldName: string): number | null => {
    if (value.trim() === "") return 0;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(`${fieldName} harus angka bulat >= 0.`);
    }
    if (num > MAX_AMOUNT) {
      throw new Error(`${fieldName} maksimal ${MAX_AMOUNT.toLocaleString("id-ID")}.`);
    }
    return num;
  };

  const handleSave = async () => {
    try {
      const validatedBonusManual = validateAmount(bonusManual, "Bonus Manual");
      const validatedPotonganManual = validateAmount(potonganManual, "Potongan Manual");
      const validatedBonusPerforma = validateAmount(bonusPerforma, "Bonus Performa");

      setIsSubmitting(true);
      const res = await fetch(`/api/payroll/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bonusManual: validatedBonusManual,
          potonganManual: validatedPotonganManual,
          bonusPerforma: validatedBonusPerforma,
          keteranganBonusPerforma: keteranganBonusPerforma.trim() || null,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(result.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Payroll berhasil diupdate.");
      // Refresh data from server
      const freshRes = await fetch(`/api/payroll/${data.id}`, { cache: "no-store" });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        setData(freshData);
      }
    } catch (e) {
      if (e instanceof Error) {
        toast.error(e.message);
      } else {
        toast.error("Terjadi kesalahan.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLock = async () => {
    if (!window.confirm("Setelah di-lock, payroll tidak bisa diubah lagi. Lanjutkan?")) {
      return;
    }

    setIsLocking(true);
    try {
      const res = await fetch(`/api/payroll/${data.id}/lock`, {
        method: "PATCH",
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(result.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      // Use undo toast for lock action
      showUndoToast(
        "Payroll berhasil di-lock. Klik Batal untuk membatalkan.",
        async () => {
          // Undo action - could call an unlock API if available
          toast.info("Lock dibatalkan (implementasi unlock diperlukan)");
        },
        10000
      );
      // Refresh data from server
      const freshRes = await fetch(`/api/payroll/${data.id}`, { cache: "no-store" });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        setData(freshData);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsLocking(false);
    }
  };

  const calculateTotalGaji = () => {
    const baseGaji =
      data.totalGaji -
      data.totalBonusAgenda -
      data.bonusManual -
      data.bonusPerforma +
      data.totalPotonganTelat +
      data.potonganManual;

    const newBonusManual = bonusManual.trim() === "" ? 0 : Number(bonusManual);
    const newPotonganManual = potonganManual.trim() === "" ? 0 : Number(potonganManual);
    const newBonusPerforma = bonusPerforma.trim() === "" ? 0 : Number(bonusPerforma);

    return (
      baseGaji +
      data.totalBonusAgenda +
      newBonusManual +
      newBonusPerforma -
      data.totalPotonganTelat -
      newPotonganManual
    );
  };

  const previewTotalGaji = calculateTotalGaji();

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Detail Payroll</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.employee.nama} ({data.employee.kode}) — {format(new Date(data.periode), "MMMM yyyy", { locale: id })}
        </p>
      </div>

      {/* Info Karyawan & Periode */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Info Karyawan & Periode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground">Nama</p>
              <p className="font-medium">{data.employee.nama}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Kode</p>
              <p className="font-mono font-medium">{data.employee.kode}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Role</p>
              <p>{data.employee.role}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Toko</p>
              <p>{data.employee.store?.nama ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tipe Perhitungan Gaji</p>
              <p>{data.employee.tipePerhitunganGaji ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tarif per Jam</p>
              <p>{formatRupiah(data.employee.tarifPerJam)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground">Periode</p>
              <p className="font-medium">{format(new Date(data.periode), "MMMM yyyy", { locale: id })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rincian Per Hari — hanya tipe JAM (koreksi jam, §7.1a) */}
      {isTipeJam && hari.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rincian Per Hari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Jam dibayar = floor(menit per hari). Bulatkan di sini kalau
              catatan absensi tidak bulat, misalnya 7 jam 50 menit -&gt; 8 jam.
              {isLocked && " Payroll sedang terkunci — buka revisi dulu."}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 font-medium">Jam server</th>
                    <th className="py-2 pr-3 font-medium">Jam dibayar</th>
                    <th className="py-2 pr-3 font-medium">Sumber</th>
                    <th className="py-2 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {hari.map((h) => {
                    const terkoreksi = h.totalMenitManual !== null;
                    const jamDibayar = Math.floor(
                      (h.totalMenitManual ?? h.totalMenitKerja) / 60
                    );
                    const terbuka = koreksiUntuk === h.id;
                    return (
                      <tr
                        key={h.id}
                        className={`border-b last:border-0 ${
                          terkoreksi ? "bg-amber-50 dark:bg-amber-950/30" : ""
                        }`}
                      >
                        <td className="py-2 pr-3 font-mono text-xs">
                          {h.tanggalShift}
                          {h.isPam && (
                            <span className="ml-1 rounded bg-purple-100 px-1 text-[10px] text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              PAM
                            </span>
                          )}
                        </td>
                        <td
                          className={`py-2 pr-3 ${terkoreksi ? "text-muted-foreground line-through" : ""}`}
                        >
                          {jamMenit(h.totalMenitKerja)}
                        </td>
                        <td className="py-2 pr-3 font-medium">
                          {jamDibayar} jam
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {terkoreksi ? (
                            <span
                              className="text-amber-700 dark:text-amber-300"
                              title={h.koreksiJamAlasan ?? undefined}
                            >
                              koreksi manual
                            </span>
                          ) : (
                            <span className="text-muted-foreground">otomatis</span>
                          )}
                        </td>
                        <td className="py-2">
                          {terbuka ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-1">
                                {["7", "8", "9", "10"].map((p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPresetJam(p)}
                                    disabled={isMengoreksi}
                                    className={`rounded border px-2 py-0.5 text-xs ${
                                      presetJam === p
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-input hover:bg-accent"
                                    }`}
                                  >
                                    {p} jam
                                  </button>
                                ))}
                                <input
                                  type="number"
                                  min={0}
                                  max={24}
                                  value={presetJam}
                                  onChange={(e) => setPresetJam(e.target.value)}
                                  disabled={isMengoreksi}
                                  className="w-16 rounded border border-input bg-background px-2 py-0.5 text-xs"
                                  aria-label="Jam kustom"
                                />
                              </div>
                              <input
                                type="text"
                                placeholder={`Alasan (min ${MIN_ALASAN_KOREKSI} karakter)`}
                                value={koreksiAlasan}
                                onChange={(e) => setKoreksiAlasan(e.target.value)}
                                disabled={isMengoreksi}
                                className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Dampak:{" "}
                                {(() => {
                                  const sebelum = Math.floor(
                                    (h.totalMenitManual ?? h.totalMenitKerja) / 60
                                  );
                                  const d = (Number(presetJam) - sebelum) * tarif;
                                  if (!Number.isFinite(d) || Number.isNaN(Number(presetJam)))
                                    return "—";
                                  return `${d >= 0 ? "+" : ""}${formatRupiah(d)}`;
                                })()}
                              </p>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => kirimKoreksi(false)}
                                  disabled={
                                    isMengoreksi ||
                                    isLocked ||
                                    koreksiAlasan.trim().length < MIN_ALASAN_KOREKSI
                                  }
                                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                                >
                                  {isMengoreksi ? "..." : "Simpan"}
                                </button>
                                {terkoreksi && (
                                  <button
                                    type="button"
                                    onClick={() => kirimKoreksi(true)}
                                    disabled={isMengoreksi || isLocked}
                                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                                  >
                                    Batalkan koreksi
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setKoreksiUntuk(null)}
                                  disabled={isMengoreksi}
                                  className="rounded px-2 py-1 text-xs text-muted-foreground"
                                >
                                  Tutup
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => bukaKoreksi(h)}
                              disabled={isLocked}
                              className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                            >
                              {terkoreksi ? "Ubah" : "Koreksi"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rincian Perhitungan Otomatis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rincian Perhitungan (Otomatis)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground">Gaji Pokok</p>
              <p className="font-mono font-medium">{formatRupiah(data.gajiPokok)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Hari Kerja</p>
              <p className="font-mono font-medium">
                {data.totalHariKerja !== null ? data.totalHariKerja : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Bonus Agenda</p>
              <p className="font-mono font-medium text-green-600 dark:text-green-400">
                {formatRupiah(data.totalBonusAgenda)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Potongan Telat</p>
              <p className="font-mono font-medium text-red-600 dark:text-red-400">
                {formatRupiah(data.totalPotonganTelat)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Input Manual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input Manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLocked && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Payroll sudah di-lock pada {formatTanggalLokal(data.lockedAt)}. Tidak
                bisa mengubah field manual.
              </div>

              {/* Jejak revisi — payslip yang pernah dikoreksi harus terlihat
                  bahwa angkanya sudah pernah direvisi (§7.1b). */}
              {data.revisiKe > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Sudah direvisi {data.revisiKe}× — angka di payslip ini pernah
                    dikoreksi setelah dikunci.
                  </p>
                  {data.revisiAlasan && (
                    <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                      Alasan terakhir: {data.revisiAlasan}
                    </p>
                  )}
                </div>
              )}

              {!showRevisiForm ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRevisiForm(true)}
                  disabled={isMerevisi}
                >
                  Revisi Payroll (buka kunci)
                </Button>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <Label htmlFor="revisi-alasan">
                    Alasan revisi (wajib, min {MIN_ALASAN_REVISI} karakter)
                  </Label>
                  <textarea
                    id="revisi-alasan"
                    placeholder="Contoh: bonus agenda terverifikasi terlambat, perlu masuk ke September."
                    value={revisiAlasan}
                    onChange={(e) => setRevisiAlasan(e.target.value)}
                    disabled={isMerevisi}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={kirimRevisi}
                      disabled={
                        isMerevisi ||
                        revisiAlasan.trim().length < MIN_ALASAN_REVISI
                      }
                    >
                      {isMerevisi ? "Memproses..." : "Buka untuk Revisi"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowRevisiForm(false);
                        setRevisiAlasan("");
                      }}
                      disabled={isMerevisi}
                    >
                      Batal
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Setelah dibuka, status kembali menjadi DRAFT — Anda bisa edit
                    field lalu mengunci lagi. Jejak revisi tercatat permanen.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="bonusManual">Bonus Manual (Rp)</Label>
              <Input
                id="bonusManual"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={bonusManual}
                onChange={(e) => setBonusManual(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="potonganManual">Potongan Manual (Rp)</Label>
              <Input
                id="potonganManual"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={potonganManual}
                onChange={(e) => setPotonganManual(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bonusPerforma">Bonus Performa (Rp)</Label>
              <Input
                id="bonusPerforma"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={bonusPerforma}
                onChange={(e) => setBonusPerforma(e.target.value)}
                disabled={isLocked || isSubmitting}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="keteranganBonusPerforma">Keterangan Bonus Performa (opsional)</Label>
              <textarea
                id="keteranganBonusPerforma"
                value={keteranganBonusPerforma}
                onChange={(e) => setKeteranganBonusPerforma(e.target.value)}
                disabled={isLocked || isSubmitting}
                rows={3}
                className="flex h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
              />
            </div>
          </div>
          {!isLocked && (
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Total Gaji */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Total Gaji</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-4">
          <p className="text-3xl font-bold font-mono text-primary">
            {formatRupiah(previewTotalGaji)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLocked ? "Final (sudah di-lock)" : "Preview — akan terupdate setelah Simpan"}
          </p>
        </CardContent>
      </Card>

      {/* Lock Button / Locked Info */}
      <Card>
        <CardContent className="space-y-3">
          {isLocked ? (
            <div className="space-y-1">
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                ✓ Payroll sudah di-lock
              </p>
              <p className="text-sm text-muted-foreground">
                Di-lock pada: {formatTanggalLokal(data.lockedAt)}
              </p>
            </div>
          ) : (
            <Button variant="destructive" onClick={handleLock} disabled={isLocking}>
              {isLocking ? "Memproses..." : "Lock Payroll (Finalisasi)"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}