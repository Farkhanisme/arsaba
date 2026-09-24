import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { SetoranHome } from "./_components/setoran-home";

// Halaman SETOR — hanya KEPALA_TOKO (dari tokonya sendiri).
// Daftar toko tujuan diambil server-side (GET /api/store 403 untuk role ini).
export default async function SetoranPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "KEPALA_TOKO") {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman setor uang hanya untuk Kepala Toko.
        </p>
      </div>
    );
  }

  const storeId = session.user.storeId;
  if (!storeId) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Akun ini tidak terhubung ke toko manapun.
        </p>
      </div>
    );
  }

  const tokoLain = await prisma.store.findMany({
    where: { aktif: true, id: { not: storeId } },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Breadcrumb autoGenerate />
      <div>
        <h1 className="text-2xl font-bold">Setor Uang</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catat penyerahan uang kas ke toko lain atau Kantor Pusat. Penerima
          mengonfirmasi di halaman Terima Setoran.
        </p>
      </div>
      <div>
        <SetoranHome tokoList={tokoLain} />
      </div>
    </div>
  );
}
