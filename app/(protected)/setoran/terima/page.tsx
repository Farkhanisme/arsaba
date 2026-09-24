import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { TerimaSetoran } from "./_components/terima-setoran";

// Halaman TERIMA — KEPALA_TOKO (terkunci tokonya) + cross-store
// (MANAJER/ADMIN/SUPERVISOR/DIREKTUR). KARYAWAN ditolak.
// DIREKTUR & SUPERVISOR lihat saja (tanpa tombol konfirmasi); API 403 ganda.
const TERIMA_ROLES = ["KEPALA_TOKO", "MANAJER", "ADMIN", "SUPERVISOR", "DIREKTUR"] as const;

export default async function TerimaSetoranPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!(TERIMA_ROLES as readonly string[]).includes(session.user.role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman terima setoran tidak tersedia untuk role Anda.
        </p>
      </div>
    );
  }

  if (session.user.role === "KEPALA_TOKO" && !session.user.storeId) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Akun ini tidak terhubung ke toko manapun.
        </p>
      </div>
    );
  }

  const stores = await prisma.store.findMany({
    where: { aktif: true },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  const storeNama =
    session.user.storeId !== null && session.user.storeId !== undefined
      ? (stores.find((s) => s.id === session.user.storeId)?.nama ?? null)
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Breadcrumb autoGenerate />
      <div>
        <h1 className="text-2xl font-bold">Terima Setoran</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Konfirmasi penerimaan uang yang disetor ke{" "}
          {session.user.role === "KEPALA_TOKO" ? (storeNama ?? "toko Anda") : "toko / Kantor Pusat"}.
        </p>
      </div>
      <div>
        <TerimaSetoran
          role={session.user.role}
          storeId={session.user.storeId ?? null}
          storeNama={storeNama}
          stores={stores}
        />
      </div>
    </div>
  );
}
