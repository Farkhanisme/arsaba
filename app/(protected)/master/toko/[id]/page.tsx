import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StoreForm } from "@/components/store/store-form";
import { ShiftTemplateList } from "@/components/shift-template/shift-template-list";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function AdminTokoEditPage({
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
    select: {
      id: true,
      nama: true,
      alias: true,
      aktif: true,
      pamEnabled: true,
    },
  });

  if (!store) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/master/toko"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Kembali ke daftar
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Edit Toko</h1>
        <p className="mt-1 text-sm text-muted-foreground">{store.nama}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Toko</CardTitle>
        </CardHeader>
        <CardContent>
          <StoreForm
            mode="edit"
            storeId={store.id}
            initial={{
              nama: store.nama,
              alias: store.alias,
              aktif: store.aktif,
              pamEnabled: store.pamEnabled,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-base">Template Shift</CardTitle>
          <Link href={`/master/toko/${store.id}/shift-template/baru`}>
            <Button size="sm">Tambah Template</Button>
          </Link>
        </CardHeader>
        <CardContent>
          <ShiftTemplateList storeId={store.id} />
        </CardContent>
      </Card>
    </div>
  );
}
