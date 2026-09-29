import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogCard } from "@/components/verifikasi/log-card";
import { OverrideKeluarForm } from "@/components/verifikasi/override-keluar-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { findShiftAcuan, formatWaktuWIB, saranMenitTelat } from "@/lib/absensi";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];

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

  // Shift acuan dihitung dari jam absen masuk, bukan dari tanggalShift, supaya
  // suggestion menit telat konsisten dengan logika check-in.
  const shiftAcuan = await findShiftAcuan(attendance.employeeId, attendance.absenMasuk);
  const saranTelat = saranMenitTelat(attendance.absenMasuk, shiftAcuan?.jamMulai ?? null);

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">{attendance.employee.nama}</h1>
        <p className="text-sm text-muted-foreground">
          {attendance.store?.nama ?? "Tanpa Toko"}
        </p>
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
            shiftAcuan={
              shiftAcuan
                ? {
                    segmen: shiftAcuan.segmen,
                    jamMulai: shiftAcuan.jamMulai.toISOString(),
                    jamSelesai: shiftAcuan.jamSelesai.toISOString(),
                  }
                : null
            }
            saranMenitTelat={saranTelat}
            isPamAwal={attendance.isPam}
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
        {attendance.absenKeluar === null && !attendance.autoClosed && (
        <OverrideKeluarForm attendanceId={attendance.id} />
      )}
      </div>
    </div>
  );
}
