import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { payrollInclude, petakanPayroll, type PayrollView } from "@/lib/payroll-view";
import { absensiMenungguVerifikasi } from "@/lib/gaji";
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

  // Absensi yang masih PENDING_VERIFIKASI = hari kerja yang TIDAK masuk gaji.
  // `POST /api/payroll/[id]/lock` akan menolak (409) selama ini masih ada, jadi
  // dikirim ke sini supaya tombolnya langsung nonaktif dengan alasannya — bukan
  // baru ketahuan setelah klik gagal.
  //
  // Hanya `statusMasuk` yang dibaca. `statusKeluar` yang pending tidak
  // berpengaruh ke perhitungan gaji sama sekali, jadi tidak boleh memblokir.
  //
  // Catatan: `PayrollView.periode` sudah berupa string ISO, sedangkan helper
  // ini menerima Date — jadi dikonversi dulu di sini.
  let belumTerverifikasi: { jumlah: number; tanggal: string[] } = { jumlah: 0, tanggal: [] };
  try {
    const periodeDate = new Date(payrollData.periode);
    const rows = await absensiMenungguVerifikasi(
      prisma,
      payrollData.employeeId,
      periodeDate
    );
    belumTerverifikasi = {
      jumlah: rows.length,
      tanggal: rows.map((r) => r.tanggalShift.toISOString().slice(0, 10)),
    };
  } catch {
    // Gagal membaca tidak boleh menutup halaman. Lock route tetap otoritatif
    // terakhir — dia yang menolak kalau memang masih ada yang tertinggal.
    belumTerverifikasi = { jumlah: 0, tanggal: [] };
  }

  return (
    <PayrollDetailClient
      initialData={payrollData}
      rincianHari={rincianHari}
      belumTerverifikasi={belumTerverifikasi}
    />
  );
}