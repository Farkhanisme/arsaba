// lib/rbac.ts
// Utilitas RBAC yang dipakai bersama.
//
// CATATAN PENTING
// ---------------
// File ini awalnya berisi HANYA `requireRole`, yang praktis tidak terpakai —
// hanya 1 dari 46 API route yang memakainya (route `test-rbac`). Setiap route
// menulis array `ALLOWED_ROLES` sendiri dengan nama yang berbeda-beda, sehingga
// `POST /api/user` dan `PATCH /api/user/[id]` sempat punya aturan yang tidak
// sinkron untuk aksi yang sama. Fungsi di bawah menutup celah itu.
//
// HIERARKI ROLE (dikonfirmasi pemilik proyek)
// ------------------------------------------
//   DIREKTUR > MANAJER > SUPERVISOR > ADMIN > KEPALA_TOKO > KARYAWAN
//
// Aturan: hanya role dengan rank lebih tinggi boleh menetapkan role orang lain.
// PENGECUALIAN: MANAJER <-> DIREKTUR saling boleh, karena organisasi ini hanya
// punya 1 Manajer dan 1 Direktur sehingga keduanya perlu bisa saling
// menunjuk pengganti satu sama lain.

import type { Session } from "next-auth";
import { Role } from "@prisma/client";

/** Rank wewenang. Semakin besar, semakin berkuasa. */
export const RANK: Record<Role, number> = {
  KARYAWAN: 1,
  KEPALA_TOKO: 2,
  ADMIN: 3,
  SUPERVISOR: 4,
  MANAJER: 5,
  DIREKTUR: 6,
};

/** Role yang TIDAK mengikuti aturan "harus rank lebih tinggi". */
const PENGECUALIAN: Partial<Record<Role, Role[]>> = {
  // Hanya ada 1 Manajer & 1 Direktur; mereka boleh saling menetapkan role.
  DIREKTUR: ["MANAJER"],
  MANAJER: ["DIREKTUR"],
};

/**
 * Apakah `actor` boleh menetapkan role `target`?
 *
 * Contoh:
 *   bolehSetRole("SUPERVISOR", "MANAJER")  -> false  (menutup eskalasi privilese)
 *   bolehSetRole("MANAJER",   "DIREKTUR") -> true   (pengecualian)
 *   bolehSetRole("MANAJER",   "KARYAWAN") -> true
 */
export function bolehSetRole(actor: Role, target: Role): boolean {
  const bebas = PENGECUALIAN[target];
  if (bebas?.includes(actor)) return true;
  return RANK[actor] > RANK[target];
}

/** Pesan error 403 yang konsisten untuk kegagalan set-role. */
export const PESAN_TIDAK_BERWENANG_ROLE =
  "Tidak berwenang menetapkan role di atas level Anda.";

/**
 * Legacy — sudah tidak dipakai route mana pun. Dipertahankan hanya supaya
 * `app/api/test-rbac` (test endpoint yang tidak seharusnya ada di produksi)
 * tidak langsung rusak. Kalau endpoint itu dihapus, hapus juga fungsi ini.
 */
export function requireRole(session: Session | null, allowedRoles: Role[]): void {
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new Error("FORBIDDEN");
  }
}
