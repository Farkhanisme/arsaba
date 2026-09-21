"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      storeId: string;
      initial: {
        nama: string;
        alias: string | null;
        aktif: boolean;
        pamEnabled: boolean;
      };
    };

export function StoreForm(props: Props) {
  const router = useRouter();
  const isCreate = props.mode === "create";
  const [nama, setNama] = useState(isCreate ? "" : props.initial.nama);
  const [alias, setAlias] = useState(
    isCreate ? "" : props.initial.alias ?? ""
  );
  const [aktif, setAktif] = useState(isCreate ? true : props.initial.aktif);
  const [pamEnabled, setPamEnabled] = useState(
    isCreate ? true : props.initial.pamEnabled
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (nama.trim().length < 2) {
      toast.error("Nama toko minimal 2 karakter.");
      return;
    }
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        nama: nama.trim(),
        alias: alias.trim() === "" ? null : alias.trim(),
        pamEnabled,
      };
      if (!isCreate) {
        body.aktif = aktif;
      }

      const url = isCreate ? "/api/store" : `/api/store/${props.storeId}`;
      const method = isCreate ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success(isCreate ? "Toko dibuat." : "Toko diubah.");
      router.push("/master/toko");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="toko-nama">Nama toko</Label>
        <Input
          id="toko-nama"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Contoh: Arsaba Induk"
          disabled={isSubmitting}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="toko-alias">Alias (opsional)</Label>
        <Input
          id="toko-alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="Nama lama / alias"
          disabled={isSubmitting}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={pamEnabled}
          onChange={(e) => setPamEnabled(e.target.checked)}
          disabled={isSubmitting}
        />
        Aktifkan PAM untuk toko ini
      </label>

      {!isCreate && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={aktif}
            onChange={(e) => setAktif(e.target.checked)}
            disabled={isSubmitting}
          />
          Toko aktif
        </label>
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={isSubmitting}>
          {isSubmitting
            ? "Menyimpan..."
            : isCreate
            ? "Simpan Toko"
            : "Simpan Perubahan"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/master/toko")}
          disabled={isSubmitting}
        >
          Batal
        </Button>
      </div>
    </div>
  );
}
