import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssignForm } from "@/components/agenda/assign-form";
import { NominalTemplateForm } from "@/components/agenda/nominal-template-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

function formatTanggalWIB(date: Date | null): string {
  if (!date) return "-";
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

export default async function DetailTemplatePage({
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

  const template = await prisma.agenda.findUnique({
    where: { id },
    include: {
      turunan: {
        orderBy: { createdAt: "desc" },
        include: {
          targetEmployee: { select: { nama: true } },
          targetStore: { select: { nama: true } },
        },
      },
    },
  });

  if (!template) notFound();
  if (template.sumber !== "TEMPLATE_PUSAT") notFound();

  const employees = await prisma.user.findMany({
    where: {
      status: "AKTIF",
      role: { in: ["KARYAWAN", "KEPALA_TOKO"] },
    },
    orderBy: { nama: "asc" },
    select: {
      id: true,
      nama: true,
      store: { select: { nama: true } },
    },
  });

  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">{template.judul}</h1>
        {template.deskripsi && (
          <p className="mt-1 text-sm text-muted-foreground">
            {template.deskripsi}
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
  Bonus:{" "}
  {template.nominal === null
    ? "belum ditetapkan"
    : formatRupiah(template.nominal)}
</p>
          <p>Deadline: {formatTanggalWIB(template.deadline)}</p>
          <p>Status: {template.status}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nominal Template</CardTitle>
        </CardHeader>
        <CardContent>
          <NominalTemplateForm
            templateId={template.id}
            nominalSaatIni={template.nominal}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assign ke Karyawan / Toko</CardTitle>
        </CardHeader>
        <CardContent>
          <AssignForm
            templateId={template.id}
            employees={employees.map((e) => ({
              id: e.id,
              nama: e.nama,
              storeNama: e.store?.nama ?? null,
            }))}
            stores={stores}
          />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold">
          Sudah di-assign ({template.turunan.length})
        </h2>

        <div className="mt-3 space-y-3">
          {template.turunan.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada yang di-assign. Gunakan form di atas.
            </p>
          )}

          {template.turunan.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-1 pt-6 text-sm">
                <p className="font-medium">
                  {t.targetEmployee?.nama ?? "(tanpa nama)"}
                  {t.targetStore && (
                    <span className="ml-2 text-muted-foreground">
                      — {t.targetStore.nama}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  Status: {t.status}
                  {t.diselesaikanPada &&
                    ` · selesai ${formatTanggalWIB(t.diselesaikanPada)}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
