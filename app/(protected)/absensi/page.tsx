import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AbsensiForm } from "@/components/absensi/absensi-form";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function formatJamWIB(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} WIB`;
}

export default async function AbsensiPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;
  if (role !== "KARYAWAN" && role !== "KEPALA_TOKO") {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman absensi hanya untuk Karyawan dan Kepala Toko.
        </p>
      </main>
    );
  }

  const shiftAktif = await prisma.attendance.findFirst({
    where: { employeeId: session.user.id, absenKeluar: null },
    orderBy: { absenMasuk: "desc" },
  });

  const mode = shiftAktif ? "check-out" : "check-in";

  return (
    <main className="container mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Absensi</h1>
      {shiftAktif && (
        <p className="mt-2 text-sm text-muted-foreground">
          Anda sedang dalam shift sejak {formatJamWIB(shiftAktif.absenMasuk)}. Lakukan check-out
          saat shift berakhir.
        </p>
      )}
      <div className="mt-6">
        <AbsensiForm mode={mode} />
      </div>
    </main>
  );
}
