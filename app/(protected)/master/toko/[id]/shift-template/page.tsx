import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";
import { ShiftTemplateList } from "@/components/shift-template/shift-template-list";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { NotFoundState } from "@/components/ui/not-found-state";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function ShiftTemplateListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman ini hanya untuk Admin, Supervisor, dan Manajer." />;
  }

  const { id } = await params;

  const store = await prisma.store.findUnique({
    where: { id },
    select: { id: true, nama: true },
  });

  if (!store) {
    return (
      <NotFoundState
        title="Toko tidak ditemukan"
        actionLabel="Kembali ke Daftar Toko"
        actionHref="/master/toko"
      />
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