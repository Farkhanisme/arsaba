"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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

const schema = z.object({
  judul: z.string().min(3, "Judul minimal 3 karakter"),
  deskripsi: z.string().optional(),
  deadline: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Format deadline harus YYYY-MM-DD"
    ),
});

type FormData = z.infer<typeof schema>;

export default function BikinAgendaBaruPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      judul: "",
      deskripsi: "",
      deadline: "",
    },
  });

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          judul: data.judul.trim(),
          deskripsi: data.deskripsi?.trim() || undefined,
          deadline: data.deadline || undefined,
        }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(resData.error || `Gagal (HTTP ${res.status})`);
        return;
      }
      toast.success("Template berhasil dibuat.");
      router.push("/manajer/agenda");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Bikin Template Agenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Setelah template dibuat, assign ke karyawan atau toko. Nominal bonus
          akan diisi oleh Manajer setelah template selesai.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Template</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="judul">Judul</Label>
              <Input
                id="judul"
                placeholder="Contoh: Bersihkan gudang belakang"
                {...form.register("judul")}
                disabled={isSubmitting}
              />
              {form.formState.errors.judul && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.judul.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="deskripsi">Deskripsi (opsional)</Label>
              <textarea
                id="deskripsi"
                placeholder="Keterangan tambahan..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...form.register("deskripsi")}
                disabled={isSubmitting}
              />
              {form.formState.errors.deskripsi && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.deskripsi.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="deadline">Deadline (opsional)</Label>
              <Input
                id="deadline"
                type="date"
                {...form.register("deadline")}
                disabled={isSubmitting}
              />
              {form.formState.errors.deadline && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.deadline.message}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan Template"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/manajer/agenda")}
                disabled={isSubmitting}
              >
                Batal
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
