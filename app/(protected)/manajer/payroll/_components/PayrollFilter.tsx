"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  defaultPeriode: string;
  defaultStatus: string;
};

export default function PayrollFilter({ defaultPeriode, defaultStatus }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handlePeriodeChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("periode", value);
    } else {
      params.delete("periode");
    }
    router.push(`/manajer/payroll?${params.toString()}`);
  };

  const handleStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("status", value);
    } else {
      params.delete("status");
    }
    router.push(`/manajer/payroll?${params.toString()}`);
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="space-y-1 w-full sm:w-auto">
        <Label htmlFor="filter-periode" className="hidden sm:block">
          Periode
        </Label>
        <Input
          id="filter-periode"
          type="month"
          value={defaultPeriode}
          onChange={(e) => handlePeriodeChange(e.target.value)}
          placeholder="Semua periode"
          className="w-full sm:w-[180px]"
        />
      </div>

      <div className="space-y-1 w-full sm:w-auto">
        <Label htmlFor="filter-status" className="hidden sm:block">
          Status
        </Label>
        <select
          id="filter-status"
          value={defaultStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua status</option>
          <option value="DRAFT">DRAFT</option>
          <option value="LOCKED">LOCKED</option>
        </select>
      </div>
    </div>
  );
}