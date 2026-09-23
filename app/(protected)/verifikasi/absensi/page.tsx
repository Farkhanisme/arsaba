import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];
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

export default async function VerifikasiAbsensiPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman verifikasi hanya untuk Supervisor, Admin, dan Manajer.
        </p>
      </main>
    );
  }

  const daftar = await prisma.attendance.findMany({
    where: {
      OR: [
        { statusMasuk: "PENDING_VERIFIKASI" },
        { statusKeluar: "PENDING_VERIFIKASI" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      employee: { select: { nama: true } },
      store: { select: { nama: true } },
    },
  });

  return (
    <main className="container mx-auto max-w-5xl">
      <Breadcrumb autoGenerate />

      <h1 className="text-2xl font-bold">Verifikasi Absensi</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {daftar.length} absensi menunggu verifikasi
      </p>

      <div className="mt-6 space-y-4">
        {daftar.length === 0 && (
          <p className="text-muted-foreground">Tidak ada absensi yang perlu diverifikasi.</p>
        )}

        {daftar.map((a) => (
          <Link
            key={a.id}
            href={`/verifikasi/absensi/${a.id}`}
            className="block"
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.employee.nama}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Toko: {a.store.nama}</p>
                <p>
                  Masuk: {formatWaktuWIB(a.absenMasuk)} — {a.statusMasuk}
                </p>
                <p>
                  Keluar: {formatWaktuWIB(a.absenKeluar)} — {a.statusKeluar}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
