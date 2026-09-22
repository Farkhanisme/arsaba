"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

type Props = {
  user: {
    nama: string | null;
    role: Role;
  };
};

type MenuItem = {
  href: string;
  label: string;
};

function menuUntukRole(role: Role): MenuItem[] {
  const items: MenuItem[] = [{ href: "/dashboard", label: "Beranda" }];

  if (role === "KARYAWAN" || role === "KEPALA_TOKO") {
    items.push({ href: "/absensi", label: "Absensi" });
    items.push({ href: "/agenda", label: "Agenda" });
  }

  if (
    role === "SUPERVISOR" ||
    role === "ADMIN" ||
    role === "MANAJER"
  ) {
    items.push({ href: "/verifikasi/absensi", label: "Verifikasi Absensi" });
    items.push({ href: "/verifikasi/agenda", label: "Verifikasi Agenda" });
    items.push({ href: "/manajer/agenda", label: "Kelola Agenda" });
    items.push({ href: "/master/toko", label: "Master Toko" });
    items.push({ href: "/master/karyawan", label: "Master Karyawan" });
  }

  if (role === "MANAJER") {
    items.push({ href: "/manajer/agenda/nominal", label: "Set Nominal" });
    items.push({ href: "/manajer/gaji", label: "Kelola Gaji" });
  }

  return items;
}

export function Navbar({ user }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = menuUntukRole(user.role);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/dashboard" className="font-bold">
          Arsaba
        </Link>

        

        {/* Menu toggle (semua device) */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile side drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <aside className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[80vw] flex-col bg-background shadow-lg">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-bold">Arsaba</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-3">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive(item.href)
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="border-t px-4 py-3">
              <p className="mb-2 text-sm text-muted-foreground">
                {user.nama ?? "-"}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="mr-1 h-4 w-4" />
                Keluar
              </Button>
            </div>
          </aside>
        </>
      )}
    </header>
  );
}
