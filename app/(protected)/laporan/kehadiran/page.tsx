import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import KehadiranReport from "./_components/KehadiranReport";

const ALLOWED_ROLES = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];
const MARK_ROLES = ["MANAJER", "ADMIN", "SUPERVISOR"];

export default async function LaporanKehadiranPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Laporan kehadiran hanya untuk Direktur, Manajer, Admin, dan Supervisor.
        </p>
      </main>
    );
  }

  const canMarkIzin = MARK_ROLES.includes(session.user.role);

  return (
    <main className="container mx-auto max-w-5xl">
      <Breadcrumb autoGenerate />

      <h1 className="text-2xl font-bold">Laporan Kehadiran</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Rekap kehadiran vs jadwal per toko untuk audit. Ketidakhadiran dihitung
        otomatis dari jadwal yang sudah di-approve dikurangi kehadiran
        terverifikasi — termasuk yang tanpa keterangan.
      </p>

      <div className="mt-6">
        <KehadiranReport canMarkIzin={canMarkIzin} />
      </div>
    </main>
  );
}
