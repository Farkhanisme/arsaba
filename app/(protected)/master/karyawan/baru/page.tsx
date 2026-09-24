import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserForm } from "@/components/user/user-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function MasterKaryawanBaruPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman ini hanya untuk Admin, Supervisor, dan Manajer.
        </p>
      </div>
    );
  }

  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Tambah Karyawan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Isi data karyawan baru. Kode login akan di-generate otomatis.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Karyawan</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm mode="create" stores={stores} currentUserRole={session.user.role} />
        </CardContent>
      </Card>
    </div>
  );
}
