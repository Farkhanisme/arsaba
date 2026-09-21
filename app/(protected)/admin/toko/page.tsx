import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN"];

export default async function AdminTokoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman ini hanya untuk Admin.
        </p>
      </main>
    );
  }

  const stores = await prisma.store.findMany({
    orderBy: { nama: "asc" },
    include: {
      _count: { select: { employees: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Master Data Toko</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stores.length} toko terdaftar.
          </p>
        </div>
        <Link href="/admin/toko/baru">
          <Button>Tambah Toko</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {stores.length === 0 && (
          <p className="text-muted-foreground">
            Belum ada toko. Klik &ldquo;Tambah Toko&rdquo; untuk memulai.
          </p>
        )}

        {stores.map((s) => (
          <Link key={s.id} href={`/admin/toko/${s.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">
                  {s.nama}
                  {!s.aktif && (
                    <span className="ml-2 text-xs font-normal text-destructive">
                      (nonaktif)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {s.alias && (
                  <p className="text-muted-foreground">Alias: {s.alias}</p>
                )}
                <p className="text-muted-foreground">
                  Karyawan: {s._count.employees}
                </p>
                <p className="text-muted-foreground">
                  PAM: {s.pamEnabled ? "aktif" : "nonaktif"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
