"use client";

import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

interface StatsBarProps {
  totalEstimasi: number;
  totalKaryawan: number;
  periode: string;
  className?: string;
}

export function StatsBar({ totalEstimasi, totalKaryawan, periode, className }: StatsBarProps) {
  return (
    <div className={cn("mb-4 flex flex-col sm:flex-row gap-3", className)}>
      <Card density="compact" className="flex-1 min-w-0">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Estimasi Payroll</p>
              <p className="font-bold font-mono text-lg">{formatRupiah(totalEstimasi)}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.71 1.067M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card density="compact" className="flex-1 min-w-0">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Karyawan Aktif</p>
              <p className="font-bold font-mono text-lg">{totalKaryawan} orang</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card density="compact" className="flex-1 min-w-0 sm:hidden">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Periode</p>
              <p className="font-bold font-mono text-sm">{new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric" }).format(new Date(periode + "-01"))}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}