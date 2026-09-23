import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";
import { ShiftTemplateList } from "@/components/shift-template/shift-template-list";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function ShiftTemplateListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const { id } = await params;

  const store = await prisma.store.findUnique({
    where: { id },
    select: { id: true, nama: true },
  });

  if (!store) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Toko tidak ditemukan</h1>
        <Link href="/master/toko" className="mt-4 inline-block text-primary hover:underline">
          Kembali ke Daftar Toko
        </Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Template Shift: {store.nama}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola pola shift mingguan untuk generate jadwal otomatis
          </p>
        </div>
        <Link href={`/master/toko/${store.id}/shift-template/baru`}>
          <Button>Tambah Template</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-0">
          <ShiftTemplateList storeId={store.id} />
        </CardContent>
      </Card>
    </div>
  );
}