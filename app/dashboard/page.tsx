import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-muted-foreground">
        Selamat datang, {session?.user?.nama || session?.user?.email || "Pengguna"}
      </p>
    </div>
  );
}