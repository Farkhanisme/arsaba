import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import PayrollDetailClient from "./_components/PayrollDetailClient";
import { AccessDenied } from "@/components/ui/access-denied";
import { NotFoundState } from "@/components/ui/not-found-state";

const ALLOWED_ROLES: Role[] = ["MANAJER"];

export default async function ManajerPayrollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman ini hanya untuk Manajer." />;
  }

  const { id } = await params;

  let payrollData: {
    id: string;
    employeeId: string;
    employee: {
      id: string;
      kode: string;
      nama: string;
      role: Role;
      tipePerhitunganGaji: string | null;
      tarifPerJam: number | null;
      storeId: string | null;
      store: { id: string; nama: string } | null;
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
  } | null = null;

  try {
    const res = await fetch(`/api/payroll/${id}`, { cache: "no-store" });
    if (res.ok) {
      payrollData = await res.json();
    }
  } catch {
    // payrollData stays null
  }

  if (!payrollData) {
    return (
      <NotFoundState
        title="Payroll tidak ditemukan"
        description="Data payroll tidak ditemukan atau terjadi kesalahan saat memuat."
        actionLabel="Kembali ke Daftar Payroll"
        actionHref="/manajer/payroll"
      />
    );
  }

  return <PayrollDetailClient initialData={payrollData} />;
}