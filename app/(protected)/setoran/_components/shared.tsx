"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/format";

// Tipe client mirror output serializeSetoran (lib/setoran.ts) — tanpa PII.
export type BuktiItem = {
  id: string;
  jenis: "SETOR" | "TERIMA";
  fileId: string;
  namaFile: string | null;
};

export type SetoranItem = {
  id: string;
  dariStoreId: string;
  dariStoreNama: string;
  tipeTujuan: "TOKO" | "PUSAT";
  tokoTujuanId: string | null;
  tokoTujuanNama: string | null;
  nominalDisetor: number;
  keterangan: string | null;
  status: "MENUNGGU_KONFIRMASI" | "DITERIMA" | "DIBATALKAN";
  disetorkanOlehNama: string;
  disetorkanPada: string;
  nominalDiterima: number | null;
  selisih: number | null;
  keteranganSelisih: string | null;
  diterimaOlehNama: string | null;
  diterimaPada: string | null;
  batalOlehNama: string | null;
  batalPada: string | null;
  alasanBatal: string | null;
  bukti: BuktiItem[];
};

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Periode default filter: bulan berjalan WIB (format YYYY-MM utk <input type="month">).
export function periodeBulanBerjalanWIB(): string {
  const wib = new Date(Date.now() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}`;
}

function keWIB(iso: string): Date {
  return new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
}

// "5 Sep 2026"
export function formatTanggalWIB(iso: string | null): string {
  if (!iso) return "-";
  const w = keWIB(iso);
  return `${w.getUTCDate()} ${BULAN_PENDEK[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

// "5 Sep 2026, 09:00"
export function formatTanggalJamWIB(iso: string | null): string {
  if (!iso) return "-";
  const w = keWIB(iso);
  const hh = String(w.getUTCHours()).padStart(2, "0");
  const mm = String(w.getUTCMinutes()).padStart(2, "0");
  return `${formatTanggalWIB(iso)}, ${hh}:${mm}`;
}

// Jumlah hari kalender WIB sejak disetor (badge "menunggu X hari").
export function hariMenungguSejak(iso: string): number {
  const buat = keWIB(iso);
  const kini = new Date(Date.now() + WIB_OFFSET_MS);
  const awalBuat = Date.UTC(buat.getUTCFullYear(), buat.getUTCMonth(), buat.getUTCDate());
  const awalKini = Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth(), kini.getUTCDate());
  return Math.max(0, Math.round((awalKini - awalBuat) / (24 * 60 * 60 * 1000)));
}

export function tujuanLabel(item: Pick<SetoranItem, "tipeTujuan" | "tokoTujuanNama">): string {
  return item.tipeTujuan === "PUSAT" ? "Kantor Pusat" : (item.tokoTujuanNama ?? "-");
}

export function StatusBadge({ status }: { status: SetoranItem["status"] }) {
  const map = {
    MENUNGGU_KONFIRMASI: "bg-amber-100 text-amber-800",
    DITERIMA: "bg-green-100 text-green-800",
    DIBATALKAN: "bg-red-100 text-red-800",
  } as const;
  const label = {
    MENUNGGU_KONFIRMASI: "Menunggu",
    DITERIMA: "Diterima",
    DIBATALKAN: "Dibatalkan",
  } as const;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

export function SelisihBadge({ selisih, keterangan }: { selisih: number | null; keterangan: string | null }) {
  if (selisih === null || selisih === 0) return null;
  const kurang = selisih < 0;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        kurang ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"
      }`}
      title={keterangan ?? undefined}
    >
      Selisih {kurang ? "−" : "+"}
      {formatRupiah(Math.abs(selisih))}
    </span>
  );
}

// Thumbnail bukti via proxy (JANGAN panggil getTelegramFileUrl client-side).
// Klik → overlay zoom sederhana.
export function FotoThumb({ fileId, namaFile }: { fileId: string; namaFile: string | null }) {
  const [zoom, setZoom] = useState(false);
  const src = `/api/telegram/file/${encodeURIComponent(fileId)}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="overflow-hidden rounded-md border"
        title={namaFile ?? "Bukti foto"}
      >
        <img src={src} alt={namaFile ?? "Bukti foto"} className="h-16 w-16 object-cover" loading="lazy" />
      </button>
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(false)}
        >
          <img
            src={src}
            alt={namaFile ?? "Bukti foto"}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      )}
    </>
  );
}

export function FotoList({ bukti, jenis }: { bukti: BuktiItem[]; jenis: "SETOR" | "TERIMA" }) {
  const items = bukti.filter((b) => b.jenis === jenis);
  if (items.length === 0) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((b) => (
        <FotoThumb key={b.id} fileId={b.fileId} namaFile={b.namaFile} />
      ))}
    </div>
  );
}

export { formatRupiah };
