import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterJadwal } from "@/components/jadwal/filter-jadwal";
import { ApproveInstanceButton } from "@/components/jadwal/approve-instance-button";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

function formatTanggalWIB(date: Date): string {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

function formatJamWIB(date: Date): string {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mi = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mi} WIB`;
}

type SearchParams = Promise<{
  storeId?: string;
  tanggalDari?: string;
  tanggalSampai?: string;
  statusJadwal?: string;
}>;

function parseTanggalUTC(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export default async function JadwalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  const params = await searchParams;
  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  const storeId =
    params.storeId && stores.some((s) => s.id === params.storeId)
      ? params.storeId
      : stores[0]?.id ?? "";

  const tanggalDari = params.tanggalDari ?? "";
  const tanggalSampai = params.tanggalSampai ?? "";
  const statusJadwalRaw = params.statusJadwal ?? "";
  const statusJadwal =
    statusJadwalRaw === "DRAFT" || statusJadwalRaw === "APPROVED"
      ? statusJadwalRaw
      : "";

  let instances: Array<{
    id: string;
    storeId: string;
    templateId: string | null;
    tanggal: Date;
    jamMulai: Date;
    jamSelesai: Date;
    statusJadwal: "DRAFT" | "APPROVED";
    sumberJadwal: "AUTO" | "MANUAL";
    catatan: string | null;
    batchId: string | null;
    createdAt: Date;
    updatedAt: Date;
    template: { nama: string } | null;
    assignments: Array<{
      id: string;
      shiftInstanceId: string;
      employeeId: string;
      segmen: "NORMAL" | "PAM";
      jamMulai: Date;
      jamSelesai: Date;
      pamDariAssignmentId?: string | null;
      pamKeterangan?: string | null;
      createdById: string | null;
      createdAt: Date;
      updatedAt: Date;
      employee: { nama: string };
    }>;
  }> = [];

  if (storeId) {
    const dDari = tanggalDari ? parseTanggalUTC(tanggalDari) : null;
    const dSampai = tanggalSampai ? parseTanggalUTC(tanggalSampai) : null;

    instances = await prisma.shiftInstance.findMany({
      where: {
        storeId,
        ...(dDari || dSampai
          ? {
              tanggal: {
                ...(dDari ? { gte: dDari } : {}),
                ...(dSampai ? { lte: dSampai } : {}),
              },
            }
          : {}),
        ...(statusJadwal ? { statusJadwal } : {}),
      },
      orderBy: [{ tanggal: "asc" }, { jamMulai: "asc" }],
      include: {
        template: { select: { nama: true } },
        assignments: {
          include: { employee: { select: { nama: true } } },
        },
      },
      take: 200,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Jadwal Shift</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {instances.length} instance ditemukan.
          </p>
        </div>
        <Link href="/jadwal/generate">
          <Button>Generate Jadwal</Button>
        </Link>
      </div>

      <FilterJadwal
        stores={stores}
        initial={{ storeId, tanggalDari, tanggalSampai, statusJadwal }}
      />

      <div className="space-y-3">
        {!storeId && (
          <p className="text-muted-foreground">
            Pilih toko terlebih dahulu untuk melihat jadwal.
          </p>
        )}
        {storeId && instances.length === 0 && (
          <p className="text-muted-foreground">
            Tidak ada jadwal dengan filter ini.
          </p>
        )}

        {instances.map((x) => (
          <Card key={x.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Link
                  href={`/jadwal/${x.id}`}
                  className="hover:underline"
                >
                  {formatTanggalWIB(x.tanggal)} · {x.template?.nama ?? "Tanpa template"}
                </Link>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-normal ${
                    x.statusJadwal === "APPROVED"
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {x.statusJadwal}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {formatJamWIB(x.jamMulai)} – {formatJamWIB(x.jamSelesai)}
              </p>
              <p className="text-muted-foreground">
                {x.assignments.length} karyawan:{" "}
                {x.assignments.map((a) => a.employee.nama).join(", ") || "—"}
              </p>
              <div className="flex gap-2 border-t pt-2">
                <Link href={`/jadwal/${x.id}`}>
                  <Button type="button" size="sm" variant="outline">
                    Kelola
                  </Button>
                </Link>
                {x.statusJadwal === "DRAFT" && (
                  <ApproveInstanceButton instanceId={x.id} />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
