import type { Prisma } from "@prisma/client";

/**
 * Bentuk data yang dipakai bersama oleh `GET /api/payroll/[id]` dan halaman
 * payslip Manajer. Dipisah supaya keduanya tidak pernah berbeda bentuk.
 *
 * Kenapa perlu ada: dulu halaman payslip memanggil API-nya sendiri lewat
 * `fetch("/api/payroll/" + id)` dari **Server Component**. Fetch relatif tidak
 * punya base URL di Server Component Next.js, jadi request-nya tidak pernah
 * sampai ke route dan `catch {}` menelan errornya — halaman selalu menampilkan
 * "Payroll tidak ditemukan". Halaman sekarang query Prisma langsung.
 */
export type PayrollWithEmployee = Prisma.PayrollGetPayload<{
  include: {
    employee: {
      select: {
        id: true;
        kode: true;
        nama: true;
        role: true;
        tipePerhitunganGaji: true;
        tarifPerJam: true;
        storeId: true;
        store: { select: { id: true; nama: true } };
      };
    };
  };
}>;

export type PayrollView = {
  id: string;
  employeeId: string;
  employee: PayrollWithEmployee["employee"];
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
  revisiKe: number;
  revisiAlasan: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `select` yang dipakai bersama oleh API route dan halaman payslip. */
export const payrollInclude = {
  employee: {
    select: {
      id: true,
      kode: true,
      nama: true,
      role: true,
      tipePerhitunganGaji: true,
      tarifPerJam: true,
      storeId: true,
      store: { select: { id: true, nama: true } },
    },
  },
} satisfies Prisma.PayrollInclude;

/**
 * Ubah record Prisma (yang punya `Date`) jadi bentuk serializable (string ISO).
 * Dipakai oleh `NextResponse.json` maupun sebagai prop ke Client Component —
 * keduanya butuh string, bukan `Date`.
 */
export function petakanPayroll(p: PayrollWithEmployee): PayrollView {
  return {
    id: p.id,
    employeeId: p.employeeId,
    employee: p.employee,
    periode: p.periode.toISOString(),
    gajiPokok: p.gajiPokok,
    totalHariKerja: p.totalHariKerja,
    totalBonusAgenda: p.totalBonusAgenda,
    totalPotonganTelat: p.totalPotonganTelat,
    bonusManual: p.bonusManual,
    potonganManual: p.potonganManual,
    bonusPerforma: p.bonusPerforma,
    keteranganBonusPerforma: p.keteranganBonusPerforma,
    totalGaji: p.totalGaji,
    status: p.status,
    lockedAt: p.lockedAt?.toISOString() ?? null,
    lockedById: p.lockedById ?? null,
    revisiKe: p.revisiKe,
    revisiAlasan: p.revisiAlasan,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
