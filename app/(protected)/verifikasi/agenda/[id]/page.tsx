import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "@/components/agenda/verify-form";
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

export default async function VerifikasiAgendaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const { id } = await params;

  const agenda = await prisma.agenda.findUnique({
    where: { id },
    include: {
      targetEmployee: { select: { nama: true } },
      targetStore: { select: { nama: true } },
      verifiedBy: { select: { nama: true } },
      template: { select: { judul: true } },
    },
  });

  if (!agenda) notFound();

  const isFinal = agenda.status !== "PENDING_VERIFIKASI";

  return (
    <div className="space-y-6">
      <Link
        href="/verifikasi/agenda"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Kembali ke daftar
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{agenda.judul}</h1>
        {agenda.deskripsi && (
          <p className="mt-1 text-sm text-muted-foreground">
            {agenda.deskripsi}
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            Karyawan: {agenda.targetEmployee?.nama ?? "(tanpa nama)"}
            {agenda.targetStore && ` — ${agenda.targetStore.nama}`}
          </p>
          <p>Sumber: {agenda.sumber}</p>
          {agenda.template && <p>Dari template: {agenda.template.judul}</p>}
          <p>Nominal: {formatRupiah(agenda.nominal)}</p>
          <p>Deadline: {formatTanggalWIB(agenda.deadline)}</p>
          <p>Diselesaikan: {formatTanggalWIB(agenda.diselesaikanPada)}</p>
          <p>Status: {agenda.status}</p>
          {agenda.verifiedBy && agenda.verifiedAt && (
            <p className="text-muted-foreground">
              Diverifikasi oleh {agenda.verifiedBy.nama} pada{" "}
              {formatTanggalWIB(agenda.verifiedAt)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bukti Penyelesaian</CardTitle>
        </CardHeader>
        <CardContent>
          {agenda.buktiFileId ? (
            <img
              src={`/api/telegram/file/${encodeURIComponent(agenda.buktiFileId)}`}
              alt="Bukti penyelesaian agenda"
              className="max-h-96 rounded-md border object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Tidak ada bukti foto.
            </p>
          )}
        </CardContent>
      </Card>

      {!isFinal && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verifikasi</CardTitle>
          </CardHeader>
          <CardContent>
            <VerifyForm
              agendaId={agenda.id}
              sumber={agenda.sumber}
              nominalSaatIni={agenda.nominal}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
