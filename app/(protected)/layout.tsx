import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        user={{
          nama: session.user.nama ?? null,
          role: session.user.role,
        }}
      />
      <main className="container mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
