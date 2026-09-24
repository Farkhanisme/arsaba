import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  /** Judul state, mis. "Payroll tidak ditemukan". */
  title: string;
  /** Penjelasan opsional bila judul saja kurang jelas. */
  description?: string;
  /** Tombol aksi kembali, mis. label "Kembali ke Daftar Toko" + href "/master/toko". */
  actionLabel: string;
  actionHref: string;
};

// State "data tidak ditemukan" — bahasa visual sama dengan AccessDenied
// (kartu terpusat + ikon + tombol aksi) agar semua state error seragam.
// Server-component friendly (tanpa "use client").
export function NotFoundState({ title, description, actionLabel, actionHref }: Props) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center">
          <SearchX
            className="mb-4 h-12 w-12 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="mt-2 text-muted-foreground">{description}</p>
          )}
          <Button asChild className="mt-6">
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
