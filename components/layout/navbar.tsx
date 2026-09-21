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
  }

  if (
    role === "SUPERVISOR" ||
    role === "ADMIN" ||
    role === "MANAJER"
  ) {
    items.push({ href: "/verifikasi/absensi", label: "Verifikasi Absensi" });
    items.push({ href: "/verifikasi/agenda", label: "Verifikasi Agenda" });
    items.push({ href: "/manajer/agenda", label: "Kelola Agenda" });
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
        <Link href="/dashboard" className="font-bold" onClick={() => setOpen(false)}>
          Arsaba
        </Link>

        {/* Desktop menu */}
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <span className="text-sm text-muted-foreground">{user.nama ?? "-"}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="mr-1 h-4 w-4" />
            Keluar
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="border-t md:hidden">
          <nav className="container mx-auto flex max-w-5xl flex-col px-4 py-2">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm ${
                  isActive(item.href)
                    ? "bg-muted font-medium"
                    : "text-muted-foreground"
                }`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="text-sm text-muted-foreground">{user.nama ?? "-"}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="mr-1 h-4 w-4" />
                Keluar
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
