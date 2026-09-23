import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import EstimasiGajiDashboard from "./_components/EstimasiGajiDashboard";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { StatsBar } from "@/components/ui/stats-bar";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function formatWaktuWIB(date: Date | null): string {
  if (!date) return "-";
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mi = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} WIB`;
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const role = user.role;

  const isKaryawan = role === "KARYAWAN" || role === "KEPALA_TOKO";
  const isVerifikator =
    role === "SUPERVISOR" || role === "ADMIN" || role === "MANAJER";
  const isManajerAtas = ["DIREKTUR", "MANAJER", "ADMIN", "SUPERVISOR"].includes(role);

  // Fetch stats for StatsBar
  const activeEmployees = await prisma.user.count({
    where: { status: "AKTIF", tipePerhitunganGaji: { not: null } },
  });
  const totalEstimasi = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COALESCE(SUM("totalGaji"), 0) as total
    FROM "Payroll"
    WHERE "status" = 'DRAFT'
  `;
  const now = new Date();
  const currentPeriode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <Breadcrumb autoGenerate />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Beranda</h1>
          <p className="text-sm text-muted-foreground">Selamat datang, {user.nama}</p>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <StatsBar
        totalEstimasi={Number(totalEstimasi[0]?.total || 0)}
        totalKaryawan={activeEmployees}
        periode={currentPeriode}
      />

      <Accordion type="single" className="space-y-3">
        {/* Estimasi Gaji Dashboard - untuk semua role */}
        <AccordionItem value="estimasi-gaji" trigger="Estimasi Gaji" content={<EstimasiGajiDashboard />} />

        {isKaryawan && (
          <AccordionItem value="absensi" trigger="Status Absensi" content={<KaryawanDashboard userId={user.id} />} />
        )}

        {isVerifikator && (
          <AccordionItem value="verifikasi" trigger="Verifikasi Absensi" content={<VerifikatorDashboard />} />
        )}

        {role === "DIREKTUR" && (
          <AccordionItem value="direktur" trigger="Dashboard Direktur" content={<Card density="compact"><CardContent className="pt-4 text-sm text-muted-foreground">Dashboard Direktur akan tersedia setelah modul laporan selesai.</CardContent></Card>} />
        )}
      </Accordion>
    </div>
  );
}

async function KaryawanDashboard({ userId }: { userId: string }) {
  const shiftAktif = await prisma.attendance.findFirst({
    where: { employeeId: userId, absenKeluar: null, autoClosed: false },
    orderBy: { absenMasuk: "desc" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {shiftAktif ? (
          <>
            <p>
              Anda sedang dalam shift sejak{" "}
              <strong>{formatWaktuWIB(shiftAktif.absenMasuk)}</strong>.
            </p>
            <Link href="/absensi">
              <Button>Lanjut Check-out</Button>
            </Link>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Anda belum absen masuk hari ini.
            </p>
            <Link href="/absensi">
              <Button>Absen Masuk</Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function VerifikatorDashboard() {
  const pendingCount = await prisma.attendance.count({
    where: {
      OR: [
        { statusMasuk: "PENDING_VERIFIKASI" },
        { statusKeluar: "PENDING_VERIFIKASI" },
      ],
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Verifikasi Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {pendingCount === 0
            ? "Tidak ada absensi menunggu verifikasi."
            : `Ada ${pendingCount} absensi menunggu verifikasi.`}
        </p>
        <Link href="/verifikasi/absensi">
          <Button variant={pendingCount > 0 ? "default" : "outline"}>
            Buka Halaman Verifikasi
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}