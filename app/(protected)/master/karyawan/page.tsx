import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function MasterKaryawanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman ini hanya untuk Admin, Supervisor, dan Manajer.
        </p>
      </main>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { nama: "asc" },
    take: 300,
    include: {
      store: { select: { nama: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Master Data Karyawan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} user terdaftar.
          </p>
        </div>
        <Link href="/master/karyawan/baru">
          <Button>Tambah Karyawan</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {users.length === 0 && (
          <p className="text-muted-foreground">
            Belum ada user. Klik &ldquo;Tambah Karyawan&rdquo; untuk memulai.
          </p>
        )}

        {users.map((u) => (
          <Link key={u.id} href={`/master/karyawan/${u.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">
                  {u.nama}
                  {u.status !== "AKTIF" && (
                    <span className="ml-2 text-xs font-normal text-destructive">
                      ({u.status})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-mono text-xs">{u.kode}</p>
                <p>
                  {u.role} · {u.store?.nama ?? "tanpa toko"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
