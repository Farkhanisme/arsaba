"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Employee = {
  id: string;
  nama: string;
  storeNama: string | null;
};

type Store = {
  id: string;
  nama: string;
};

type Props = {
  templateId: string;
  employees: Employee[];
  stores: Store[];
};

type TargetType = "EMPLOYEE" | "STORE";

export function AssignForm({ templateId, employees, stores }: Props) {
  const router = useRouter();
  const [targetType, setTargetType] = useState<TargetType>("EMPLOYEE");
  const [targetId, setTargetId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const opsi = targetType === "EMPLOYEE" ? employees : stores;

  const submit = async () => {
    if (!targetId) {
      toast.error(
        targetType === "EMPLOYEE"
          ? "Pilih karyawan terlebih dahulu."
          : "Pilih toko terlebih dahulu."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agenda/${templateId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success(
        targetType === "EMPLOYEE"
          ? "Berhasil di-assign ke karyawan."
          : `Berhasil di-assign ke ${data.count} karyawan toko.`
      );
      setTargetId("");
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
        <Label htmlFor="targetType">Tipe target</Label>
        <select
          id="targetType"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value as TargetType);
            setTargetId("");
          }}
          disabled={isSubmitting}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="EMPLOYEE">Karyawan</option>
          <option value="STORE">Toko (semua karyawan)</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="targetId">
          {targetType === "EMPLOYEE" ? "Karyawan" : "Toko"}
        </Label>
        <select
          id="targetId"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          disabled={isSubmitting}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {targetType === "EMPLOYEE"
              ? `-- Pilih karyawan (${employees.length}) --`
              : `-- Pilih toko (${stores.length}) --`}
          </option>
          {targetType === "EMPLOYEE"
            ? employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nama}
                  {e.storeNama ? ` — ${e.storeNama}` : ""}
                </option>
              ))
            : stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
        </select>
      </div>

      <Button type="button" onClick={submit} disabled={isSubmitting || !targetId}>
        {isSubmitting ? "Meng-assign..." : "Assign"}
      </Button>
    </div>
  );
}
