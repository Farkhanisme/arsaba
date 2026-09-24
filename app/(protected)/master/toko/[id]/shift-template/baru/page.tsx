import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@prisma/client";
import { ShiftTemplateForm } from "@/components/shift-template/shift-template-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { NotFoundState } from "@/components/ui/not-found-state";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function ShiftTemplateCreatePage({
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

      <div>
        <h1 className="text-2xl font-bold">Buat Template Shift Baru</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Toko: {store.nama}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form Template Shift</CardTitle>
        </CardHeader>
        <CardContent>
          <ShiftTemplateForm mode="create" storeId={store.id} />
        </CardContent>
      </Card>
    </div>
  );
}