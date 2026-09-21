import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StoreForm } from "@/components/store/store-form";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function AdminTokoBaruPage() {
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

  return (
    <div className="space-y-6">
      <Link
        href="/master/toko"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Kembali ke daftar
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Tambah Toko</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Isi data toko baru.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Toko</CardTitle>
        </CardHeader>
        <CardContent>
          <StoreForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
