import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StoreForm } from "@/components/store/store-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function AdminTokoBaruPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman ini hanya untuk Admin, Supervisor, dan Manajer." />;
  }

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

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
