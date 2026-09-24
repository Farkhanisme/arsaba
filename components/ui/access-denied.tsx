import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  /** Pesan spesifik per halaman, mis. "Halaman ini hanya untuk Admin." */
  description: string;
  title?: string;
  /** Tampilkan tombol kembali ke Beranda. Default true. */
  showHomeButton?: boolean;
};

// Halaman khusus "akses ditolak" — satu-satunya tampilan 403 di seluruh
// aplikasi. Dipakai oleh semua page protected sebagai pengganti blok
// inline, agar pesan & tampilan seragam. Server-component friendly
// (tanpa "use client") sehingga bisa dipakai langsung di page.tsx.
export function AccessDenied({
  description,
  title = "Akses ditolak",
  showHomeButton = true,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center">
          <ShieldAlert
            className="mb-4 h-12 w-12 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-muted-foreground">{description}</p>
          {showHomeButton && (
            <Button asChild className="mt-6">
              <Link href="/dashboard">Kembali ke Beranda</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
