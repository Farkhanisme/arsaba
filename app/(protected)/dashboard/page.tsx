import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import EstimasiGajiDashboard from "./_components/EstimasiGajiDashboard";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { StatsBar } from "@/components/ui/stats-bar";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { findShiftBerikutnya, formatWaktuWIB } from "@/lib/absensi";

// Role yang boleh melakukan absensi — sama persis dengan guard di
// app/api/absensi/route.ts, supaya dashboard konsisten dengan API.
const ALLOWED_CHECKIN_ROLES = ["KARYAWAN", "KEPALA_TOKO", "SUPERVISOR", "ADMIN"];

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const role = user.role;

  const isKaryawan = ALLOWED_CHECKIN_ROLES.includes(role);
  const isVerifikator =
    role === "SUPERVISOR" || role === "ADMIN" || role === "MANAJER";

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
    <div className="space-y-6">
      <Breadcrumb autoGenerate />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Beranda</h1>
          <p className="mt-1 text-sm text-muted-foreground">Selamat datang, {user.nama}</p>
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
          <AccordionItem
            value="absensi"
            trigger="Status Absensi"
            content={<KaryawanDashboard userId={user.id} />}
          />
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
  const now = new Date();
  const shiftAktif = await prisma.attendance.findFirst({
    where: { employeeId: userId, absenKeluar: null, autoClosed: false },
    orderBy: { absenMasuk: "desc" },
    select: { absenMasuk: true },
  });
  // Shift berikutnya hanya relevan kalau tidak sedang ada shift berjalan —
  // dan kalau ada, jangan query sama sekali.
  const shiftBerikutnya = shiftAktif ? null : await findShiftBerikutnya(userId, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Blok shift — tambahan di atas blok status yang sudah ada. */}
        <div className="rounded-md border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Shift Anda</p>
          {shiftAktif ? (
            <p className="mt-1">
              <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                Sedang berjalan
              </span>
              <span className="ml-2 text-muted-foreground">
                sejak {formatWaktuWIB(shiftAktif.absenMasuk)}
              </span>
            </p>
          ) : shiftBerikutnya ? (
            <div className="mt-1">
              <p>
                {shiftBerikutnya.segmen === "PAM" ? "PAM" : shiftBerikutnya.storeNama} —{" "}
                <strong>
                  {formatWaktuWIB(shiftBerikutnya.jamMulai)} –{" "}
                  {formatWaktuWIB(shiftBerikutnya.jamSelesai)}
                </strong>
              </p>
              {shiftBerikutnya.segmen === "PAM" && (
                <p className="text-xs text-muted-foreground">
                  Penugasan backup di {shiftBerikutnya.storeNama}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Tidak ada jadwal shift terdaftar.
            </p>
          )}
        </div>

        {shiftAktif ? (
          <Link href="/absensi">
            <Button>Lanjut Check-out</Button>
          </Link>
        ) : (
          <Link href="/absensi">
            <Button>Absen Masuk</Button>
          </Link>
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