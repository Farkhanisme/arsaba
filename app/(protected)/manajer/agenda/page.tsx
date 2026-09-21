import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

function formatTanggalWIB(date: Date | null): string {
  if (!date) return "tanpa deadline";
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

export default async function KelolaAgendaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <main className="container mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman ini hanya untuk Admin, Supervisor, dan Manajer.
        </p>
      </main>
    );
  }

  const templates = await prisma.agenda.findMany({
    where: {
      sumber: "TEMPLATE_PUSAT",
      targetEmployeeId: null,
      targetStoreId: null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { turunan: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Kelola Template Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bikin template, lalu assign ke karyawan atau toko.
          </p>
        </div>
        <Link href="/manajer/agenda/baru">
          <Button>Bikin Template Baru</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {templates.length === 0 && (
          <p className="text-muted-foreground">
            Belum ada template. Klik &ldquo;Bikin Template Baru&rdquo; untuk memulai.
          </p>
        )}

        {templates.map((t) => (
          <Link key={t.id} href={`/manajer/agenda/${t.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">{t.judul}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
  Bonus:{" "}
  {t.nominal === null ? "belum ditetapkan" : formatRupiah(t.nominal)}
</p>
                <p className="text-muted-foreground">
                  Deadline: {formatTanggalWIB(t.deadline)}
                </p>
                <p className="text-muted-foreground">
                  Sudah di-assign: {t._count.turunan} kali
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
