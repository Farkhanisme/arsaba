"use client";

import Link from "next/link";
import { format } from "date-fns";
import { id } from "date-fns/locale";

type PayrollItem = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    kode: string;
    nama: string;
    role: string;
    tipePerhitunganGaji: string | null;
  };
  periode: string;
  gajiPokok: number;
  totalHariKerja: number | null;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  bonusManual: number;
  potonganManual: number;
  bonusPerforma: number;
  keteranganBonusPerforma: string | null;
  totalGaji: number;
  status: string;
  lockedAt: string | null;
  lockedById: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatRupiah(n: number | null): string {
  if (n === null) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

function formatPeriode(periodeStr: string): string {
  try {
    const date = new Date(periodeStr);
    return format(date, "MMMM yyyy", { locale: id });
  } catch {
    return periodeStr;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "LOCKED") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
        LOCKED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
      DRAFT
    </span>
  );
}

type Props = {
  items: PayrollItem[];
};

export default function PayrollTable({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Belum ada payroll untuk filter ini. Generate dulu untuk periode yang diinginkan.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 font-medium">Kode</th>
            <th className="pb-2 font-medium">Nama</th>
            <th className="pb-2 font-medium">Tipe Gaji</th>
            <th className="pb-2 font-medium text-right">Gaji Pokok</th>
            <th className="pb-2 font-medium text-right">Hari Kerja</th>
            <th className="pb-2 font-medium text-right">Bonus Agenda</th>
            <th className="pb-2 font-medium text-right">Potongan Telat</th>
            <th className="pb-2 font-medium text-right">Bonus Manual</th>
            <th className="pb-2 font-medium text-right">Potongan Manual</th>
            <th className="pb-2 font-medium text-right">Bonus Performa</th>
            <th className="pb-2 font-medium text-right">Total Gaji</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted/50">
              <td className="py-3 font-mono">{item.employee.kode}</td>
              <td className="py-3">{item.employee.nama}</td>
              <td className="py-3 text-muted-foreground">
                {item.employee.tipePerhitunganGaji ?? "—"}
              </td>
              <td className="py-3 text-right font-mono">{formatRupiah(item.gajiPokok)}</td>
              <td className="py-3 text-right font-mono">
                {item.totalHariKerja !== null ? item.totalHariKerja : "—"}
              </td>
              <td className="py-3 text-right font-mono">{formatRupiah(item.totalBonusAgenda)}</td>
              <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">
                {formatRupiah(item.totalPotonganTelat)}
              </td>
              <td className="py-3 text-right font-mono text-green-600 dark:text-green-400">
                {formatRupiah(item.bonusManual)}
              </td>
              <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">
                {formatRupiah(item.potonganManual)}
              </td>
              <td className="py-3 text-right font-mono text-green-600 dark:text-green-400">
                {formatRupiah(item.bonusPerforma)}
              </td>
              <td className="py-3 text-right font-medium font-mono">
                {formatRupiah(item.totalGaji)}
              </td>
              <td className="py-3"><StatusBadge status={item.status} /></td>
              <td className="py-3">
                <Link
                  href={`/manajer/payroll/${item.id}`}
                  className="text-primary hover:underline"
                >
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}