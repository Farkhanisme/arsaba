import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@prisma/client";
import PayrollGenerateForm from "./_components/PayrollGenerateForm";
import PayrollTable from "./_components/PayrollTable";
import PayrollFilter from "./_components/PayrollFilter";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

const ALLOWED_ROLES: Role[] = ["MANAJER"];

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

  // Build API URL with filters
  const params = new URLSearchParams();
  if (periodeParam) params.set("periode", periodeParam);
  if (statusParam) params.set("status", statusParam);

  const apiUrl = `/api/payroll?${params.toString()}`;

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
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (res.ok) {
      payrollData = await res.json();
    }
  } catch {
    // payrollData stays empty
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