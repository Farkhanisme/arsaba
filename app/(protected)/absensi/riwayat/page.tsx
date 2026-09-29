import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { RiwayatAbsensi } from "@/components/absensi/riwayat-absensi";
import { prisma } from "@/lib/prisma";

const ALLOWED_ROLES = ["KARYAWAN", "KEPALA_TOKO", "SUPERVISOR", "ADMIN"];

export default async function RiwayatAbsensiPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <AccessDenied description="Halaman riwayat absensi hanya untuk Karyawan, Kepala Toko, Supervisor, dan Admin." />
    );
  }

  const shiftAktif = await prisma.attendance.findFirst({
    where: {
      employeeId: session.user.id,
      absenKeluar: null,
      autoClosed: false,
    },
    orderBy: { absenMasuk: "desc" },
    select: { id: true },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />
      <div>
        <h1 className="text-2xl font-bold">Riwayat Absensi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          30 catatan absensi terakhir milik Anda.
        </p>
      </div>
      <RiwayatAbsensi shiftAktifId={shiftAktif?.id ?? null} />
    </div>
  );
}
