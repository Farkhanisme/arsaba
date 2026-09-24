import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import KehadiranReport from "./_components/KehadiranReport";

const ALLOWED_ROLES = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"];
const MARK_ROLES = ["MANAJER", "ADMIN", "SUPERVISOR"];

export default async function LaporanKehadiranPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Laporan kehadiran hanya untuk Direktur, Manajer, Admin, dan Supervisor." />;
  }

  const canMarkIzin = MARK_ROLES.includes(session.user.role);

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Laporan Kehadiran</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rekap kehadiran vs jadwal per toko untuk audit. Ketidakhadiran dihitung
          otomatis dari jadwal yang sudah di-approve dikurangi kehadiran
          terverifikasi — termasuk yang tanpa keterangan.
        </p>
      </div>

      <div>
        <KehadiranReport canMarkIzin={canMarkIzin} />
      </div>
    </div>
  );
}
