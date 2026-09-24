import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AccessDenied } from "@/components/ui/access-denied";
import { SetoranHome } from "./_components/setoran-home";

// Halaman SETOR — hanya KEPALA_TOKO (dari tokonya sendiri).
// Daftar toko tujuan diambil server-side (GET /api/store 403 untuk role ini).
export default async function SetoranPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "KEPALA_TOKO") {
    return <AccessDenied description="Halaman setor uang hanya untuk Kepala Toko." />;
  }

  const storeId = session.user.storeId;
  if (!storeId) {
    return <AccessDenied description="Akun ini tidak terhubung ke toko manapun." />;
  }

  const tokoLain = await prisma.store.findMany({
    where: { aktif: true, id: { not: storeId } },
    orderBy: { nama: "asc" },
    select: { id: true, nama: true },
  });

  return (
    <div className="space-y-6">
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
