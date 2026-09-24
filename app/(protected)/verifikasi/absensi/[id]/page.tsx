import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogCard } from "@/components/verifikasi/log-card";
import { OverrideKeluarForm } from "@/components/verifikasi/override-keluar-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

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

export default async function VerifikasiAbsensiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman verifikasi hanya untuk Supervisor, Admin, dan Manajer." />;
  }

  const { id } = await params;

  const attendance = await prisma.attendance.findUnique({
    where: { id },
    include: {
      employee: { select: { nama: true } },
      store: { select: { nama: true } },
      logs: {
        orderBy: { createdAt: "asc" },
        include: { verifiedBy: { select: { nama: true } } },
      },
    },
  });

  if (!attendance) notFound();

  const jadwalAcuan = await prisma.shiftAssignment.findMany({
    where: {
      employeeId: attendance.employeeId,
      shiftInstance: {
        tanggal: attendance.tanggalShift,
        statusJadwal: "APPROVED",
      },
    },
    select: {
      segmen: true,
      jamMulai: true,
      jamSelesai: true,
    },
    orderBy: { jamMulai: "asc" },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">{attendance.employee.nama}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{attendance.store.nama}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ringkasan Shift</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Tanggal shift: {formatWaktuWIB(attendance.tanggalShift)}</p>
          <p>
            Absen masuk: {formatWaktuWIB(attendance.absenMasuk)} — {attendance.statusMasuk}
          </p>
          <p>Foto masuk diambil: {formatWaktuWIB(attendance.fotoMasukDiambilPada)}</p>
          <p>
            Absen keluar: {formatWaktuWIB(attendance.absenKeluar)} — {attendance.statusKeluar}
          </p>
          <p>Foto keluar diambil: {formatWaktuWIB(attendance.fotoKeluarDiambilPada)}</p>
          {attendance.autoClosed && (
            <p className="text-destructive">
              Shift di-auto-close pada {formatWaktuWIB(attendance.autoClosedAt)} karena tidak check-out.
            </p>
          )}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">Riwayat Log</h2>
      <div className="space-y-3">
        {attendance.logs.map((log) => (
          <LogCard
            key={log.id}
            attendanceId={attendance.id}
            jadwalAcuan={jadwalAcuan.map((j) => ({
              segmen: j.segmen,
              jamMulai: j.jamMulai.toISOString(),
              jamSelesai: j.jamSelesai.toISOString(),
            }))}
            log={{
              id: log.id,
              jenis: log.jenis,
              status: log.status,
              absenServerPada: log.absenServerPada.toISOString(),
              latitude: log.latitude,
              longitude: log.longitude,
              fotoFileId: log.fotoFileId,
              keteranganKoreksi: log.keteranganKoreksi,
              rejectedReason: log.rejectedReason,
              verifiedAt: log.verifiedAt ? log.verifiedAt.toISOString() : null,
              verifiedByName: log.verifiedBy?.nama ?? null,
              isOverride: log.isOverride,
            }}
          />
        ))}
      {attendance.absenKeluar === null && (
        <OverrideKeluarForm attendanceId={attendance.id} />
      )}
      </div>
    </div>
  );
}
