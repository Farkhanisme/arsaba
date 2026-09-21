import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["SUPERVISOR", "ADMIN", "MANAJER"];

function formatRupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

function formatTanggalWIB(date: Date | null): string {
  if (!date) return "-";
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mi = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} WIB`;
}

export default async function VerifikasiAgendaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

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

  const daftar = await prisma.agenda.findMany({
    where: {
      status: "PENDING_VERIFIKASI",
      targetEmployeeId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      targetEmployee: { select: { nama: true } },
      targetStore: { select: { nama: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verifikasi Agenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {daftar.length} agenda menunggu verifikasi
        </p>
      </div>

      <div className="space-y-3">
        {daftar.length === 0 && (
          <p className="text-muted-foreground">
            Tidak ada agenda yang perlu diverifikasi.
          </p>
        )}

        {daftar.map((a) => (
          <Link key={a.id} href={`/verifikasi/agenda/${a.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">{a.judul}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  {a.targetEmployee?.nama ?? "(tanpa nama)"}
                  {a.targetStore && (
                    <span className="ml-2 text-muted-foreground">
                      — {a.targetStore.nama}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  Sumber: {a.sumber} · Nominal: {formatRupiah(a.nominal)}
                </p>
                <p className="text-muted-foreground">
                  Diselesaikan: {formatTanggalWIB(a.diselesaikanPada)}
                  {a.buktiBeforeFileId && a.buktiAfterFileId
                    ? " · ada bukti before + after"
                    : a.buktiBeforeFileId
                    ? " · ada bukti before"
                    : a.buktiAfterFileId
                    ? " · ada bukti after"
                    : " · tanpa bukti"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
