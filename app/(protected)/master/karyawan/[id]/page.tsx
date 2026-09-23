import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserForm } from "@/components/user/user-form";
import { ResetPasswordForm } from "@/components/user/reset-password-form";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const RESETTABLE_TARGET_ROLES: Role[] = [
  "KARYAWAN",
  "KEPALA_TOKO",
  "SUPERVISOR",
  "ADMIN",
];

export default async function MasterKaryawanEditPage({
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

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      kode: true,
      nama: true,
      role: true,
      storeId: true,
      status: true,
      tanggalMasuk: true,
      nik: true,
      tempatLahir: true,
      tanggalLahir: true,
      alamat: true,
      kontakDarurat: true,
    },
  });

  if (!user) notFound();

  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  const bisaResetPassword =
    user.id !== session.user.id &&
    RESETTABLE_TARGET_ROLES.includes(user.role);

  return (
    <div className="space-y-6">
      <Link
        href="/master/karyawan"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Kembali ke daftar
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Edit Karyawan</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.nama}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Karyawan</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm
            mode="edit"
            userId={user.id}
            stores={stores}
            currentUserRole={session.user.role}
            initial={{
              kode: user.kode,
              nama: user.nama,
              role: user.role,
              storeId: user.storeId,
              status: user.status,
              tanggalMasuk: user.tanggalMasuk
                ? user.tanggalMasuk.toISOString()
                : null,
              nik: user.nik,
              tempatLahir: user.tempatLahir,
              tanggalLahir: user.tanggalLahir
                ? user.tanggalLahir.toISOString()
                : null,
              alamat: user.alamat,
              kontakDarurat: user.kontakDarurat,
            }}
          />
        </CardContent>
      </Card>

      {bisaResetPassword && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reset Password</CardTitle>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm userId={user.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
