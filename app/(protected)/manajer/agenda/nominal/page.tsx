"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { showProgressToast, completeProgressToast, showSuccessWithAction } from "@/components/ui/action-toast";
import { Select } from "@/components/ui/select";

type AgendaItem = {
  id: string;
  judul: string;
  sumber: "TEMPLATE_PUSAT" | "MANDIRI_KARYAWAN";
  nominal: number | null;
  status: string;
  targetEmployeeNama: string | null;
  targetStoreNama: string | null;
  templateId: string | null;
};

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

export default function NominalAgendaPage() {
  const router = useRouter();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter batch
  const [batchSumber, setBatchSumber] = useState<
    "" | "TEMPLATE_PUSAT" | "MANDIRI_KARYAWAN"
  >("");
  const [batchTemplateId, setBatchTemplateId] = useState("");
  const [batchNominal, setBatchNominal] = useState("");
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; judul: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agenda?status=DIVERIFIKASI");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal load (HTTP ${res.status})`);
        return;
      }
      // Filter nominal null di client
      const filtered = (data.items as AgendaItem[]).filter(
        (a) => a.nominal === null
      );
      setItems(filtered);
    } catch {
      toast.error("Gagal memuat daftar agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Daftar template untuk dropdown. Sebelumnya UI meminta user MENGETIK cuid
  // template secara manual - hampir pasti salah ketik, dan karena filter-nya
  // opsional, bisa diam-diam menerapkan ke SELURUH sumber agenda.
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/agenda?status=DIVERIFIKASI");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const unik = new Map<string, string>();
      for (const a of (data.items as AgendaItem[]) ?? []) {
        if (a.templateId && a.judul && !unik.has(a.templateId)) {
          unik.set(a.templateId, a.judul);
        }
      }
      setTemplates([...unik.entries()].map(([id, judul]) => ({ id, judul })));
    } catch {
      // bukan kritis - dropdown tetap bisa dikosongkan
    }
  }, []);

  useEffect(() => {
    load();
    loadTemplates();
  }, [load, loadTemplates]);

  /** Body request untuk nominal-batch, dipakai preview & commit. */
  const buildBatchBody = (withPreview: boolean) => {
    const b: Record<string, unknown> = { nominal: Number(batchNominal) };
    if (withPreview) b.preview = true;
    if (batchSumber) b.sumber = batchSumber;
    if (batchTemplateId) b.templateId = batchTemplateId;
    return b;
  };

  /**
   * Dua tahap. Dulu route ini memakai `updateMany` massal tanpa preview, jadi
   * satu klik bisa mengubah ratusan agenda lintas toko tanpa konfirmasi dan
   * tanpa jejak audit. Sekarang: hitung dulu -> tunjukkan ke user -> konfirmasi.
   */
  const kirimBatch = async () => {
    const n = Number(batchNominal);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Nominal harus angka bulat >= 0.");
      return;
    }
    if (batchSumber === "" && !batchTemplateId) {
      toast.error("Pilih minimal satu filter: sumber atau template.");
      return;
    }

    setIsBatchSubmitting(true);
    showProgressToast({
      message: "Menghitung agenda yang terdampak...",
      isLoading: true,
    });

    try {
      // Tahap 1 - preview (tidak mengubah apa pun).
      const previewRes = await fetch("/api/agenda/nominal-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBatchBody(true)),
      });
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        completeProgressToast(
          false,
          preview.error || `Gagal (HTTP ${previewRes.status})`
        );
        return;
      }

      const total: number = preview.total ?? 0;
      const terkunci: number = preview.ditolakLocked ?? 0;

      if (total === 0) {
        completeProgressToast(
          false,
          preview.pesan || "Tidak ada agenda yang cocok."
        );
        return;
      }

      // Konfirmasi eksplisit dengan jumlah yang akan benar-benar berubah.
      const contoh: string[] = Array.isArray(preview.sample)
        ? preview.sample.map((s: { judul: string }) => s.judul)
        : [];
      const pesanKonfirmasi =
        `Terapkan nominal ${formatRupiah(n)} ke ${total} agenda` +
        (terkunci > 0
          ? `\n(${terkunci} agenda dilewati karena payroll-nya sudah dikunci)`
          : "") +
        "?" +
        (contoh.length > 0 ? `\n\nContoh:\n- ${contoh.join("\n- ")}` : "");

      const yakin = window.confirm(pesanKonfirmasi);
      if (!yakin) {
        completeProgressToast(false, "Dibatalkan. Tidak ada agenda yang diubah.");
        return;
      }

      // Tahap 2 - commit.
      const res = await fetch("/api/agenda/nominal-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBatchBody(false)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        completeProgressToast(false, data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      completeProgressToast(true, `Berhasil set nominal ke ${data.updated} agenda.`);
      showSuccessWithAction(
        `Berhasil set nominal ke ${data.updated} agenda.`,
        "Refresh",
        () => {
          router.refresh();
          load();
        },
        10000
      );
      setBatchNominal("");
    } catch {
      completeProgressToast(false, "Terjadi kesalahan jaringan.");
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Set Nominal Agenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agenda yang sudah diverifikasi dan belum punya nominal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="batch-sumber">Filter sumber</Label>
              <Select
                id="batch-sumber"
                value={batchSumber}
                onChange={(e) =>
                  setBatchSumber(
                    e.target.value as "" | "TEMPLATE_PUSAT" | "MANDIRI_KARYAWAN"
                  )
                }
                disabled={isBatchSubmitting}
              >
                <option value="">— semua sumber —</option>
                <option value="TEMPLATE_PUSAT">Template Pusat</option>
                <option value="MANDIRI_KARYAWAN">Mandiri Karyawan</option>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="batch-template">Template (opsional)</Label>
              <Select
                id="batch-template"
                value={batchTemplateId}
                onChange={(e) => setBatchTemplateId(e.target.value)}
                disabled={isBatchSubmitting}
              >
                <option value="">— semua template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.judul}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Dulu field ini meminta cuid yang diketik manual. Pilih dari daftar
                agar tidak salah — filter yang kosong berarti berlaku ke semua
                template.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="batch-nominal">Nominal (Rp)</Label>
              <Input
                id="batch-nominal"
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 50000"
                value={batchNominal}
                onChange={(e) => setBatchNominal(e.target.value)}
                disabled={isBatchSubmitting}
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={kirimBatch}
            disabled={isBatchSubmitting}
          >
            {isBatchSubmitting ? "Memproses..." : "Terapkan ke Semua"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold">
          Per Agenda ({items.length})
        </h2>

        <div className="mt-3 space-y-3">
          {loading && (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          )}
          {!loading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Tidak ada agenda yang menunggu penetapan nominal.
            </p>
          )}
          {items.map((a) => (
            <ItemNominal
              key={a.id}
              item={a}
              onSuccess={() => {
                router.refresh();
                load();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemNominal({
  item,
  onSuccess,
}: {
  item: AgendaItem;
  onSuccess: () => void;
}) {
  const [nominal, setNominal] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const kirim = async () => {
    const n = Number(nominal);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Nominal harus angka bulat >= 0.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agenda/${item.id}/nominal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nominal: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      const propagated = data.propagatedCount ?? 0;
      toast.success(
        propagated > 0
          ? `Nominal diset + propagate ke ${propagated} turunan.`
          : "Nominal diset."
      );
      setNominal("");
      onSuccess();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{item.judul}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {item.targetEmployeeNama ?? "(tanpa nama)"}
          {item.targetStoreNama && ` — ${item.targetStoreNama}`}
        </p>
        <p className="text-muted-foreground">
          Sumber: {item.sumber} · Nominal saat ini: {formatRupiah(item.nominal)}
        </p>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`nominal-${item.id}`}>Nominal baru (Rp)</Label>
            <Input
              id={`nominal-${item.id}`}
              type="text"
              inputMode="numeric"
              placeholder="Contoh: 50000"
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <Button
            type="button"
            onClick={kirim}
            disabled={isSubmitting || nominal.trim() === ""}
          >
            {isSubmitting ? "..." : "Set Nominal"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
