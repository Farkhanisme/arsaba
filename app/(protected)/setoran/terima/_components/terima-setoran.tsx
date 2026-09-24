"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import {
  FotoList,
  SelisihBadge,
  StatusBadge,
  formatRupiah,
  formatTanggalJamWIB,
  hariMenungguSejak,
  periodeBulanBerjalanWIB,
  tujuanLabel,
  type SetoranItem,
} from "../../_components/shared";

type Props = {
  role: Role;
  storeId: string | null;
  storeNama: string | null;
  stores: { id: string; nama: string }[];
};

const MIME_OK = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE = 5;

// Mirror server: boleh konfirmasi = kepala toko tujuan (TOKO) / MANAJER|ADMIN (PUSAT).
// DIREKTUR & SUPERVISOR lihat saja. API menegakkan ulang (403 ganda).
function bolehKonfirmasi(item: SetoranItem, role: Role, storeId: string | null): boolean {
  if (item.tipeTujuan === "TOKO") {
    return role === "KEPALA_TOKO" && storeId !== null && storeId === item.tokoTujuanId;
  }
  return role === "MANAJER" || role === "ADMIN";
}

export function TerimaSetoran({ role, storeId, storeNama, stores }: Props) {
  const isKepalaToko = role === "KEPALA_TOKO";
  const [periode, setPeriode] = useState(periodeBulanBerjalanWIB);
  const [tokoId, setTokoId] = useState("");
  const [tab, setTab] = useState<"tunggu" | "riwayat">("tunggu");
  const [termasukBatal, setTermasukBatal] = useState(false);
  const [items, setItems] = useState<SetoranItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State modal konfirmasi.
  const [konfirmasi, setKonfirmasi] = useState<SetoranItem | null>(null);
  const [nominalDiterima, setNominalDiterima] = useState("");
  const [keteranganSelisih, setKeteranganSelisih] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [mengonfirmasi, setMengonfirmasi] = useState(false);

  const statusParam = tab === "tunggu" ? "MENUNGGU_KONFIRMASI" : termasukBatal ? "" : "DITERIMA";

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ arah: "terima", periode });
      if (statusParam) q.set("status", statusParam);
      // Kepala toko terkunci ke tokonya (API menolak tokoId lain dengan 403).
      if (!isKepalaToko && tokoId) q.set("tokoId", tokoId);
      const res = await fetch(`/api/setoran?${q.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && data.error) || `Gagal (HTTP ${res.status})`);
        return;
      }
      const semua: SetoranItem[] = Array.isArray(data.items) ? data.items : [];
      // Toggle "termasuk batal": API satu status per request — saring di client.
      // Tab riwayat tidak pernah menampilkan MENUNGGU_KONFIRMASI.
      setItems(
        tab === "riwayat" && !termasukBatal
          ? semua.filter((it) => it.status === "DITERIMA")
          : tab === "riwayat"
            ? semua.filter((it) => it.status !== "MENUNGGU_KONFIRMASI")
            : semua
      );
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setLoading(false);
    }
  }, [periode, statusParam, tokoId, isKepalaToko, tab, termasukBatal]);

  useEffect(() => {
    muat();
  }, [muat]);

  const bukaKonfirmasi = (item: SetoranItem) => {
    setKonfirmasi(item);
    setNominalDiterima(String(item.nominalDisetor));
    setKeteranganSelisih("");
    for (const u of previews) URL.revokeObjectURL(u);
    setFiles([]);
    setPreviews([]);
  };

  const tutupKonfirmasi = () => {
    setKonfirmasi(null);
    for (const u of previews) URL.revokeObjectURL(u);
    setFiles([]);
    setPreviews([]);
  };

  const tambahFiles = (list: FileList | null) => {
    if (!list) return;
    if (files.length + list.length > MAX_FILE) {
      toast.error(`Maksimal ${MAX_FILE} foto bukti.`);
    }
    for (const f of Array.from(list)) {
      if (!MIME_OK.includes(f.type)) {
        toast.error(`File '${f.name}' harus gambar (jpeg/png/webp).`);
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`File '${f.name}' melebihi 10 MB.`);
        return;
      }
    }
    const baru = [...files, ...Array.from(list)].slice(0, MAX_FILE);
    setFiles(baru);
    setPreviews(baru.map((f) => URL.createObjectURL(f)));
  };

  const terimaNum = Number(nominalDiterima);
  const terimaValid = Number.isInteger(terimaNum) && terimaNum > 0;
  const selisihPreview = useMemo(() => {
    if (!konfirmasi || !terimaValid) return null;
    return terimaNum - konfirmasi.nominalDisetor;
  }, [konfirmasi, terimaValid, terimaNum]);

  const handleKonfirmasi = async () => {
    if (!konfirmasi) return;
    if (!terimaValid) {
      toast.error("Nominal diterima harus bilangan bulat rupiah lebih dari 0.");
      return;
    }
    if (selisihPreview !== null && selisihPreview !== 0 && !keteranganSelisih.trim()) {
      toast.error("Nominal berbeda — keterangan selisih wajib diisi.");
      return;
    }
    if (files.length < 1) {
      toast.error("Lampirkan minimal 1 foto bukti terima.");
      return;
    }
    setMengonfirmasi(true);
    try {
      const fd = new FormData();
      fd.append("nominalDiterima", String(terimaNum));
      if (keteranganSelisih.trim()) fd.append("keteranganSelisih", keteranganSelisih.trim());
      for (const f of files) fd.append("foto", f);
      const res = await fetch(`/api/setoran/${encodeURIComponent(konfirmasi.id)}/terima`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data && data.error) || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Setoran dikonfirmasi diterima.");
      tutupKonfirmasi();
      muat();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setMengonfirmasi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter bar (WAJIB): periode + toko */}
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="periode">Periode</Label>
            <Input
              id="periode"
              type="month"
              value={periode}
              onChange={(e) => e.target.value && setPeriode(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="toko">Toko</Label>
            {isKepalaToko ? (
              <Input id="toko" type="text" value={storeNama ?? "-"} disabled className="w-auto" />
            ) : (
              <Select
                id="toko"
                value={tokoId}
                onChange={(e) => setTokoId(e.target.value)}
              >
                <option value="">Semua toko</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nama}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {(role === "DIREKTUR" || role === "SUPERVISOR") && (
            <p className="text-sm text-muted-foreground">Mode lihat saja untuk role Anda.</p>
          )}
        </CardContent>
      </Card>

      {/* Tab */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={tab === "tunggu" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("tunggu")}
        >
          Belum Dikonfirmasi
        </Button>
        <Button
          type="button"
          variant={tab === "riwayat" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("riwayat")}
        >
          Riwayat Diterima
        </Button>
        {tab === "riwayat" && (
          <label className="ml-2 flex items-center gap-1 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={termasukBatal}
              onChange={(e) => setTermasukBatal(e.target.checked)}
            />
            Termasuk batal
          </label>
        )}
      </div>

      {/* Daftar */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {!loading && error && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={muat}>
              Coba lagi
            </Button>
          </CardContent>
        </Card>
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyStateCard
          title={tab === "tunggu" ? "Tidak ada yang menunggu" : "Riwayat kosong"}
          description={`Tidak ada setoran pada periode ${periode} untuk filter ini.`}
          illustration="search"
        />
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((it) => {
            const bisa = it.status === "MENUNGGU_KONFIRMASI" && bolehKonfirmasi(it, role, storeId);
            const hari = it.status === "MENUNGGU_KONFIRMASI" ? hariMenungguSejak(it.disetorkanPada) : 0;
            return (
              <li key={it.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {it.dariStoreNama} → {tujuanLabel(it)} · {formatRupiah(it.nominalDisetor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Disetor {it.disetorkanOlehNama} · {formatTanggalJamWIB(it.disetorkanPada)} WIB
                      {it.keterangan ? ` · ${it.keterangan}` : ""}
                    </p>
                    {hari > 0 && (
                      <p className="text-xs font-medium text-amber-700">
                        Menunggu {hari} hari
                      </p>
                    )}
                  </div>
                  <StatusBadge status={it.status} />
                </div>

                <div className="mt-2">
                  <p className="mb-1 text-xs text-muted-foreground">Bukti setor:</p>
                  <FotoList bukti={it.bukti} jenis="SETOR" />
                </div>

                {it.status === "DITERIMA" && (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-muted-foreground">
                      Diterima: {formatRupiah(it.nominalDiterima ?? 0)} oleh{" "}
                      {it.diterimaOlehNama ?? "-"} · {formatTanggalJamWIB(it.diterimaPada)} WIB
                    </p>
                    <SelisihBadge selisih={it.selisih} keterangan={it.keteranganSelisih} />
                    {it.selisih !== null && it.selisih !== 0 && it.keteranganSelisih && (
                      <p className="text-muted-foreground">Ket: {it.keteranganSelisih}</p>
                    )}
                    {it.bukti.some((b) => b.jenis === "TERIMA") && (
                      <div className="mt-1">
                        <p className="mb-1 text-muted-foreground">Bukti terima:</p>
                        <FotoList bukti={it.bukti} jenis="TERIMA" />
                      </div>
                    )}
                  </div>
                )}

                {it.status === "DIBATALKAN" && it.alasanBatal && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dibatalkan oleh {it.batalOlehNama ?? "-"}: {it.alasanBatal}
                  </p>
                )}

                {bisa && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2"
                    onClick={() => bukaKonfirmasi(it)}
                  >
                    Konfirmasi Terima
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal konfirmasi */}
      {konfirmasi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle>Konfirmasi Terima</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {konfirmasi.dariStoreNama} → {tujuanLabel(konfirmasi)} · Disetor{" "}
                {formatRupiah(konfirmasi.nominalDisetor)}
              </p>

              <div className="space-y-1">
                <Label htmlFor="nominalDiterima">Nominal diterima (Rp)</Label>
                <Input
                  id="nominalDiterima"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={nominalDiterima}
                  onChange={(e) => setNominalDiterima(e.target.value)}
                />
                {selisihPreview !== null && selisihPreview !== 0 && (
                  <p className="text-sm font-medium text-amber-700">
                    Selisih {selisihPreview < 0 ? "−" : "+"}
                    {formatRupiah(Math.abs(selisihPreview))} — keterangan wajib diisi.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="keteranganSelisih">
                  Keterangan selisih{" "}
                  {selisihPreview !== null && selisihPreview !== 0 ? "(wajib)" : "(opsional)"}
                </Label>
                <Input
                  id="keteranganSelisih"
                  type="text"
                  maxLength={200}
                  placeholder="cth. Kurang ongkos ojek"
                  value={keteranganSelisih}
                  onChange={(e) => setKeteranganSelisih(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Foto bukti terima (≥1, maks {MAX_FILE})</Label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    tambahFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {previews.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {previews.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt="Bukti terima"
                        className="h-20 w-20 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="button" disabled={mengonfirmasi} onClick={handleKonfirmasi}>
                  {mengonfirmasi ? "Mengonfirmasi..." : "Terima Setoran"}
                </Button>
                <Button type="button" variant="outline" onClick={tutupKonfirmasi}>
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
