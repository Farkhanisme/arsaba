import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AbsensiForm } from "@/components/absensi/absensi-form";

export default async function AbsensiPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;
  if (role !== "KARYAWAN" && role !== "KEPALA_TOKO") {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-muted-foreground">
          Halaman absensi hanya untuk Karyawan dan Kepala Toko.
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Absensi</h1>
      <AbsensiForm />
    </main>
  );
}
