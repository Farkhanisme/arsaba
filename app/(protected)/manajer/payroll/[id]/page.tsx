import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { payrollInclude, petakanPayroll, type PayrollView } from "@/lib/payroll-view";
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

  // Query Prisma LANGSUNG, bukan lewat `fetch("/api/payroll/" + id)`.
  //
  // Halaman ini Server Component, dan fetch relatif di Server Component Next.js
  // tidak punya base URL — request-nya tidak pernah sampai ke route, `catch`
  // menelan errornya, dan halaman selalu tampil "Payroll tidak ditemukan".
  // Mapper-nya dipakai bersama dengan `GET /api/payroll/[id]` (lib/payroll-view)
  // supaya bentuk datanya tidak pernah berbeda.
  let payrollData: PayrollView | null = null;
  try {
    const payroll = await prisma.payroll.findUnique({
      where: { id },
      include: payrollInclude,
    });
    if (payroll) payrollData = petakanPayroll(payroll);
  } catch (err) {
    console.error("Halaman payslip: gagal memuat payroll", id, err);
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

  // Rincian per hari — HANYA untuk tipe JAM, karena hanya tipe JAM yang jumlah
  // jamnya bisa dikoreksi (§7.1a). Tanpa data ini, Manajer tidak bisa melihat
  // hari mana yang tercatat 7 jam 50 menit dan perlu dibulatkan.
  type HariDetail = {
    id: string;
    tanggalShift: string;
    absenMasuk: string | null;
    absenKeluar: string | null;
    totalMenitKerja: number;
    totalMenitManual: number | null;
    koreksiJamAlasan: string | null;
    koreksiJamPada: string | null;
    isPam: boolean;
  };

  let rincianHari: HariDetail[] = [];
  if (payrollData.employee.tipePerhitunganGaji === "JAM") {
    try {
      const [y, m] = payrollData.periode.split("-").map(Number);
      const awal = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
      const akhir = new Date(Date.UTC(y ?? 1970, m ?? 1, 1));
      const rows = await prisma.attendance.findMany({
        where: {
          employeeId: payrollData.employeeId,
          tanggalShift: { gte: awal, lt: akhir },
          statusMasuk: "DIVERIFIKASI",
        },
        orderBy: { tanggalShift: "asc" },
        select: {
          id: true,
          tanggalShift: true,
          absenMasuk: true,
          absenKeluar: true,
          totalMenitKerja: true,
          totalMenitManual: true,
          koreksiJamAlasan: true,
          koreksiJamPada: true,
          isPam: true,
        },
      });
      rincianHari = rows.map((r) => ({
        id: r.id,
        tanggalShift: r.tanggalShift.toISOString().slice(0, 10),
        absenMasuk: r.absenMasuk?.toISOString() ?? null,
        absenKeluar: r.absenKeluar?.toISOString() ?? null,
        totalMenitKerja: r.totalMenitKerja,
        totalMenitManual: r.totalMenitManual,
        koreksiJamAlasan: r.koreksiJamAlasan,
        koreksiJamPada: r.koreksiJamPada?.toISOString() ?? null,
        isPam: r.isPam,
      }));
    } catch {
      rincianHari = [];
    }
  }

  return <PayrollDetailClient initialData={payrollData} rincianHari={rincianHari} />;
}