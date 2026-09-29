import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Prisma, Role } from "@prisma/client";
import PayrollGenerateForm from "./_components/PayrollGenerateForm";
import PayrollTable from "./_components/PayrollTable";
import PayrollFilter from "./_components/PayrollFilter";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

const ALLOWED_ROLES: Role[] = ["MANAJER"];

/** Status yang valid — sama persis dengan yang diterima `GET /api/payroll`. */
const STATUS_VALID = ["DRAFT", "LOCKED"] as const;
const PERIODE_RE = /^\d{4}-\d{2}$/;

export default async function ManajerPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman ini hanya untuk Manajer." />;
  }

  const { periode: periodeParam, status: statusParam } = await searchParams;

  // Query Prisma LANGSUNG, bukan lewat `fetch("/api/payroll?...")`.
  //
  // Halaman ini Server Component, dan fetch relatif di Server Component Next.js
  // tidak punya base URL — request-nya tidak pernah sampai ke route, `catch`
  // menelan errornya, dan halaman SELALU menampilkan "Daftar Payroll (0)"
  // tanpa satu pun error di log. Pola yang sama sudah diperbaiki di
  // `payroll/[id]/page.tsx`; ini versi daftar.
  //
  // Filter di bawah sengaja mengikuti `GET /api/payroll` baris demi baris,
  // supaya kedua pintu itu tidak pernah berbeda: param tak sah diabaikan (bukan
  // 400, karena halaman harus tetap merender) dan hasilnya identik.
  const where: Prisma.PayrollWhereInput = {};

  if (periodeParam && PERIODE_RE.test(periodeParam)) {
    const [yStr, mStr] = periodeParam.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    // m dicek 1..12 supaya "2026-13" tidak jadi UTC 2027-01 diam-diam.
    if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
      where.periode = new Date(Date.UTC(y, m - 1, 1));
    }
  }

  if (statusParam && (STATUS_VALID as readonly string[]).includes(statusParam)) {
    where.status = statusParam;
  }

  let payrollData: {
    total: number;
    items: Array<{
      id: string;
      employeeId: string;
      employee: {
        id: string;
        kode: string;
        nama: string;
        role: Role;
        tipePerhitunganGaji: string | null;
      };
      periode: string;
      gajiPokok: number;
      totalHariKerja: number | null;
      totalBonusAgenda: number;
      totalPotonganTelat: number;
      bonusManual: number;
      potonganManual: number;
      bonusPerforma: number;
      keteranganBonusPerforma: string | null;
      totalGaji: number;
      status: string;
      lockedAt: string | null;
      lockedById: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  } = { total: 0, items: [] };

  try {
    const rows = await prisma.payroll.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            kode: true,
            nama: true,
            role: true,
            tipePerhitunganGaji: true,
          },
        },
      },
      orderBy: [{ periode: "desc" }, { employee: { nama: "asc" } }],
    });

    payrollData = {
      total: rows.length,
      items: rows.map((p) => ({
        id: p.id,
        employeeId: p.employeeId,
        employee: p.employee,
        periode: p.periode.toISOString(),
        gajiPokok: p.gajiPokok,
        totalHariKerja: p.totalHariKerja,
        totalBonusAgenda: p.totalBonusAgenda,
        totalPotonganTelat: p.totalPotonganTelat,
        bonusManual: p.bonusManual,
        potonganManual: p.potonganManual,
        bonusPerforma: p.bonusPerforma,
        keteranganBonusPerforma: p.keteranganBonusPerforma,
        totalGaji: p.totalGaji,
        status: p.status,
        lockedAt: p.lockedAt?.toISOString() ?? null,
        lockedById: p.lockedById ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  } catch (err) {
    // Jangan pakai `catch {}` yang diam — kalau query-nya benar-benar gagal,
    // halaman akan menampilkan "0" dan itu indistinguishable dari "memang 0".
    console.error("Halaman daftar payroll: gagal memuat data", err);
  }

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Kelola Payroll Bulanan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate, review, dan lock payroll karyawan per periode.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate Payroll Baru</CardTitle>
        </CardHeader>
        <CardContent>
          <PayrollGenerateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <PayrollFilter
            defaultPeriode={periodeParam ?? ""}
            defaultStatus={statusParam ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Daftar Payroll ({payrollData.total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PayrollTable items={payrollData.items} />
        </CardContent>
      </Card>
    </div>
  );
}