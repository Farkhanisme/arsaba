import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateForm } from "@/components/jadwal/generate-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function GenerateJadwalPage() {
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

  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <Link
        href="/jadwal"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Kembali ke daftar jadwal
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Generate Jadwal Otomatis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat jadwal untuk rentang tanggal sekaligus. Semua karyawan aktif
          akan dirotasi merata ke seluruh shift template.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parameter Generate</CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateForm stores={stores} />
        </CardContent>
      </Card>
    </div>
  );
}
