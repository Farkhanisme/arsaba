import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AbsensiForm } from "@/components/absensi/absensi-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { formatWaktuWIB } from "@/lib/absensi";

// Supervisor/Admin juga absen (bisa tanpa toko). Manajer & Direktur tidak.
const ALLOWED_CHECKIN_ROLES = ["KARYAWAN", "KEPALA_TOKO", "SUPERVISOR", "ADMIN"];

export default async function AbsensiPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;
  if (!ALLOWED_CHECKIN_ROLES.includes(role)) {
    return (
      <AccessDenied description="Halaman absensi hanya untuk Karyawan, Kepala Toko, Supervisor, dan Admin." />
    );
  }

  // Filter autoClosed harus sama dengan API check-in (route.ts) — kalau tidak,
  // record yang sudah auto-close (absenKeluar terisi) tidak akan muncul di sini.
  const shiftAktif = await prisma.attendance.findFirst({
    where: {
      employeeId: session.user.id,
      absenKeluar: null,
      autoClosed: false,
    },
    orderBy: { absenMasuk: "desc" },
  });

  const mode = shiftAktif ? "check-out" : "check-in";

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Absensi</h1>
          {shiftAktif && (
            <p className="mt-1 text-sm text-muted-foreground">
              Anda sedang dalam shift sejak {formatWaktuWIB(shiftAktif.absenMasuk)}.
              Lakukan check-out saat shift berakhir.
            </p>
          )}
        </div>
        <Link
          href="/absensi/riwayat"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Riwayat absensi
        </Link>
      </div>
      <div>
        <AbsensiForm mode={mode} />
      </div>
    </div>
  );
}
