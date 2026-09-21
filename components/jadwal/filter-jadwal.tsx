"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = {
  id: string;
  nama: string;
};

type Props = {
  stores: Store[];
  initial: {
    storeId: string;
    tanggalDari: string;
    tanggalSampai: string;
    statusJadwal: string;
  };
};

export function FilterJadwal({ stores, initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [storeId, setStoreId] = useState(initial.storeId);
  const [tanggalDari, setTanggalDari] = useState(initial.tanggalDari);
  const [tanggalSampai, setTanggalSampai] = useState(initial.tanggalSampai);
  const [statusJadwal, setStatusJadwal] = useState(initial.statusJadwal);

  const submit = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (storeId) params.set("storeId", storeId);
    else params.delete("storeId");
    if (tanggalDari) params.set("tanggalDari", tanggalDari);
    else params.delete("tanggalDari");
    if (tanggalSampai) params.set("tanggalSampai", tanggalSampai);
    else params.delete("tanggalSampai");
    if (statusJadwal) params.set("statusJadwal", statusJadwal);
    else params.delete("statusJadwal");

    startTransition(() => {
      router.push(`/jadwal?${params.toString()}`);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="filter-store">Toko</Label>
          <select
            id="filter-store"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            disabled={isPending}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— pilih toko —</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-dari">Dari tanggal</Label>
          <Input
            id="filter-dari"
            type="date"
            value={tanggalDari}
            onChange={(e) => setTanggalDari(e.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-sampai">Sampai tanggal</Label>
          <Input
            id="filter-sampai"
            type="date"
            value={tanggalSampai}
            onChange={(e) => setTanggalSampai(e.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-status">Status</Label>
          <select
            id="filter-status"
            value={statusJadwal}
            onChange={(e) => setStatusJadwal(e.target.value)}
            disabled={isPending}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— semua —</option>
            <option value="DRAFT">DRAFT</option>
            <option value="APPROVED">APPROVED</option>
          </select>
        </div>
      </div>

      <Button type="button" onClick={submit} disabled={isPending || !storeId}>
        {isPending ? "Memuat..." : "Terapkan Filter"}
      </Button>
    </div>
  );
}
