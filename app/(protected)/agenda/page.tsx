import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelesaiForm } from "@/components/agenda/selesai-form";
import { LaporMandiriForm } from "@/components/agenda/lapor-mandiri-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const ALLOWED_ROLES: Role[] = ["KARYAWAN", "KEPALA_TOKO"];

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

function formatTanggalWIB(date: Date | null): string {
  if (!date) return "-";
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

export default async function AgendaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman ini hanya untuk Karyawan dan Kepala Toko.
        </p>
      </div>
    );
  }

  const items = await prisma.agenda.findMany({
    where: { targetEmployeeId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      targetStore: { select: { nama: true } },
    },
  });

  const belumSelesai = items.filter(
    (a) => a.status === "PENDING_VERIFIKASI" && a.diselesaikanPada === null
  );
  const menungguVerifikasi = items.filter(
    (a) => a.status === "PENDING_VERIFIKASI" && a.diselesaikanPada !== null
  );
  const final = items.filter((a) => a.status !== "PENDING_VERIFIKASI");

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Agenda Saya</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tugas yang di-assign ke Anda dan laporan kegiatan mandiri.
        </p>
      </div>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          + Lapor Kegiatan Mandiri
        </summary>
        <div className="mt-4">
          <LaporMandiriForm />
        </div>
      </details>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Belum Selesai ({belumSelesai.length})
        </h2>
        {belumSelesai.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada tugas yang menunggu dikerjakan.
          </p>
        )}
        {belumSelesai.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-base">{a.judul}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {a.deskripsi && (
                <p className="text-muted-foreground">{a.deskripsi}</p>
              )}
              <p>
  Bonus:{" "}
  {a.nominal === null ? "belum ditetapkan" : formatRupiah(a.nominal)}
</p>
              <p className="text-muted-foreground">
                Deadline: {formatTanggalWIB(a.deadline)}
              </p>
              <SelesaiForm agendaId={a.id} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Menunggu Verifikasi ({menungguVerifikasi.length})
        </h2>
        {menungguVerifikasi.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada agenda yang menunggu verifikasi.
          </p>
        )}
        {menungguVerifikasi.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-base">{a.judul}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
  Bonus:{" "}
  {a.nominal === null ? "belum ditetapkan" : formatRupiah(a.nominal)}
</p>
              <p className="text-muted-foreground">
                Selesai: {formatTanggalWIB(a.diselesaikanPada)}
              </p>
              <p className="text-muted-foreground">
                Menunggu verifikasi admin.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Riwayat ({final.length})
        </h2>
        {final.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada riwayat.
          </p>
        )}
        {final.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {a.judul} — {a.status}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
  Bonus:{" "}
  {a.nominal === null ? "belum ditetapkan" : formatRupiah(a.nominal)}
</p>
              <p className="text-muted-foreground">
                Selesai: {formatTanggalWIB(a.diselesaikanPada)}
              </p>
              <p className="text-muted-foreground">
                Diverifikasi: {formatTanggalWIB(a.verifiedAt)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
