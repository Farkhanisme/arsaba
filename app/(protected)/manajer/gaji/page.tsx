import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GajiForm } from "@/components/user/gaji-form";
import type { Role } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const TARGET_ROLES: Role[] = ["SUPERVISOR", "ADMIN", "KEPALA_TOKO", "KARYAWAN"];

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp" + n.toLocaleString("id-ID");
}

export default async function ManajerGajiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return <AccessDenied description="Halaman ini hanya untuk Manajer." />;
  }

  const users = await prisma.user.findMany({
    where: {
      role: { in: TARGET_ROLES },
      status: "AKTIF",
    },
    orderBy: { nama: "asc" },
    take: 300,
    select: {
      id: true,
      kode: true,
      nama: true,
      role: true,
      tipePerhitunganGaji: true,
      tarifPerJam: true,
      gajiPokok: { select: { nominal: true } },
      store: { select: { nama: true } },
    },
  });

  return (
    <div className="space-y-6">
      <Breadcrumb autoGenerate />

      <div>
        <h1 className="text-2xl font-bold">Kelola Gaji Karyawan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {users.length} karyawan aktif (supervisor ke bawah).
        </p>
      </div>

      <div className="space-y-3">
        {users.length === 0 && (
          <p className="text-muted-foreground">
            Belum ada karyawan aktif yang bisa diatur gajinya.
          </p>
        )}

        {users.map((u) => (
          <Card key={u.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {u.nama}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {u.kode}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {u.role} · {u.store?.nama ?? "tanpa toko"}
              </p>
              <p className="text-muted-foreground">
                Tipe saat ini: {u.tipePerhitunganGaji ?? "belum ditentukan"} ·
                Tarif/jam: {formatRupiah(u.tarifPerJam)} · Gaji pokok:{" "}
                {formatRupiah(u.gajiPokok?.nominal ?? null)}
              </p>
              <div className="border-t pt-3">
                <GajiForm
                  userId={u.id}
                  initial={{
                    tipePerhitunganGaji: u.tipePerhitunganGaji,
                    tarifPerJam: u.tarifPerJam,
                    nominalGajiPokok: u.gajiPokok?.nominal ?? null,
                  }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
