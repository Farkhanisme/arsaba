"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  autoGenerate?: boolean;
  separator?: React.ReactNode;
  className?: string;
}

const routeLabels: Record<string, string> = {
  dashboard: "Beranda",
  absensi: "Absensi",
  agenda: "Agenda",
  jadwal: "Jadwal",
  verifikasi: "Verifikasi",
  master: "Master Data",
  toko: "Toko",
  karyawan: "Karyawan",
  "shift-template": "Template Shift",
  manajer: "Manajer",
  payroll: "Payroll",
  gaji: "Gaji",
};

export function Breadcrumb({
  items,
  autoGenerate = true,
  separator,
  className,
}: BreadcrumbProps) {
  const defaultSeparator = <ChevronRight className="h-4 w-4 text-muted-foreground" />;
  const sep = separator ?? defaultSeparator;
  const pathname = usePathname();
  
  const breadcrumbItems = items || (autoGenerate ? generateBreadcrumbs(pathname) : []);

  if (breadcrumbItems.length === 0) return null;

  return (
    <nav className={cn("flex items-center gap-1 text-sm", className)} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1">
        <li>
          <Link href="/dashboard" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Home className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Beranda</span>
          </Link>
        </li>
        {breadcrumbItems.map((item, index) => {
            return (
              <li key={item.label} className="flex items-center">
                {sep}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-muted-foreground hover:text-foreground transition-colors font-medium"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-foreground font-medium" aria-current="page">
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
      </ol>
    </nav>
  );
}

function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean);
  const items: BreadcrumbItem[] = [];
  let currentPath = "";

  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = routeLabels[segment] || segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    items.push({ label, href: currentPath !== pathname ? currentPath : undefined });
  }

  return items;
}

interface BreadcrumbItemProps {
  label: string;
  href?: string;
  isCurrent?: boolean;
}

export function BreadcrumbItem({ label, href, isCurrent }: BreadcrumbItemProps) {
  if (isCurrent || !href) {
    return (
      <span className="text-foreground font-medium" aria-current={isCurrent ? "page" : undefined}>
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className="text-muted-foreground hover:text-foreground transition-colors font-medium">
      {label}
    </Link>
  );
}