import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { Role } from "@prisma/client";
import PayrollDetailClient from "./_components/PayrollDetailClient";

const ALLOWED_ROLES: Role[] = ["MANAJER"];

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

export default async function ManajerPayrollDetailPage({
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
          Halaman ini hanya untuk Manajer.
        </p>
      </main>
    );
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
      <div className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Payroll tidak ditemukan</h1>
        <p className="mt-2 text-muted-foreground">
          Data payroll tidak ditemukan atau terjadi kesalahan saat memuat.
        </p>
        <Link href="/manajer/payroll" className="mt-4 inline-block text-primary hover:underline">
          Kembali ke Daftar Payroll
        </Link>
      </div>
    );
  }

  return (
    <PayrollDetailClient initialData={payrollData} />
  );
}