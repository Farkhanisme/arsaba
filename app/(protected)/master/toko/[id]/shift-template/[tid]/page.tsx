import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@prisma/client";
import { ShiftTemplateForm } from "@/components/shift-template/shift-template-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

export default async function ShiftTemplateEditPage({
  params,
}: {
  params: Promise<{ id: string; tid: string }>;
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

  const { id, tid } = await params;

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

  const template = await prisma.shiftTemplate.findUnique({
    where: { id: tid },
    select: {
      id: true,
      nama: true,
      jamMulaiMenit: true,
      jamSelesaiMenit: true,
      lintasHari: true,
      hariKerja: true,
      aktif: true,
      storeId: true,
    },
  });

  if (!template || template.storeId !== store.id) {
    notFound();
  }

  function menitToTime(menit: number): string {
    const jam = Math.floor(menit / 60);
    const m = menit % 60;
    return `${String(jam).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const initial = {
    nama: template.nama,
    jamMulai: menitToTime(template.jamMulaiMenit),
    jamSelesai: menitToTime(template.jamSelesaiMenit),
    lintasHari: template.lintasHari,
    hariKerja: template.hariKerja,
    aktif: template.aktif,
  };

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Edit Template Shift</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {template.nama} · {store.nama}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form Template Shift</CardTitle>
        </CardHeader>
        <CardContent>
          <ShiftTemplateForm mode="edit" templateId={template.id} initial={initial} />
        </CardContent>
      </Card>
    </div>
  );
}