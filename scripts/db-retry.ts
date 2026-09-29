// scripts/db-retry.ts
// Helper retry untuk skrip regresi terhadap pooler Neon free-tier.
//
// MASALAH
// -------
// Pooler free-tier Neon sering drop koneksi (P1001 "Can't reach database server").
// Gejalanya tidak selalu di awal skrip — kadang di tengah, setelah belasan query
// sudah jalan. Akibatnya regression suite gagal padahal logika yang diuji tidak
// salah, dan cleanup pun terlewat sehingga meninggalkan residue di DB.
//
// SOLUSI
// ------
// Dua lapis:
//   1. `tungguDB()` — preflight, tunggu DB "dingin" sampai bisa dijangkau.
//   2. `dbClient()`  — Proxy yang membungkus SETIAP query dengan retry + backoff.
//
// Syarat retry hanya error TRANSIEN (koneksi putus / timeout). Error logika
// seperti P2002 (unique constraint) atau P2025 (not found) TIDAK di-retry —
// retry di situ hanya memperlambat dan menutupi bug asli.
//
// PAKAI
// -----
//   import { prisma as prismaRaw } from "@/lib/prisma";
//   import { dbClient, tungguDB } from "./db-retry";
//   const prisma = dbClient(prismaRaw);
//   await tungguDB();

/** True kalau error-nya sementara (koneksi putus / timeout), bukan bug logika. */
export function isTransient(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const s = `${err?.code ?? ""} ${err?.message ?? ""} ${String(e)}`;
  return /P1001|P1002|P1008|P1017|P2024|P2034|Can't reach database server|Connection closed|closed the connection|Server has closed|timed out|Timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up/i.test(
    s
  );
}

export const RETRY_MAX = 5;
export const RETRY_BASE_MS = 2000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label = "query"
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e) || attempt === RETRY_MAX) break;
      const wait = RETRY_BASE_MS * attempt;
      console.log(
        `    ↻ ${label} — koneksi putus, retry ${attempt}/${RETRY_MAX - 1} (tunggu ${wait / 1000}s)`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

// Method yang TIDAK boleh di-retry: menutup koneksi, atau mengubah klien.
const NO_RETRY = new Set([
  "$disconnect",
  "$connect",
  "$on",
  "$use",
  "$extends",
]);

/**
 * Bungkus PrismaClient (atau objek apa pun) sehingga setiap method-nya di-retry.
 * Mendukung delegasi `prisma.user.findUnique(...)` dan `prisma.$transaction(...)`.
 */
export function dbClient<T extends object>(obj: T, prefix = ""): T {
  return new Proxy(obj, {
    get(target, prop) {
      const nilai = Reflect.get(target, prop);

      if (typeof nilai !== "function") {
        // Delegasi ke model: prisma.user -> { findUnique, create, ... }
        if (nilai && typeof nilai === "object") {
          return dbClient(nilai as object, `${prefix}${String(prop)}.`);
        }
        return nilai;
      }

      const nama = `${prefix}${String(prop)}`;
      const fn = nilai as (...a: unknown[]) => Promise<unknown>;

      if (NO_RETRY.has(String(prop))) {
        return fn.bind(target);
      }
      // $transaction menerima callback; retry di level luar tetap aman karena
      // transaction yang gagal sudah di-rollback oleh Prisma.
      return (...args: unknown[]) => withRetry(() => fn.apply(target, args), nama);
    },
  }) as T;
}

/**
 * Tunggu DB bisa dijangkau sebelum skrip mulai bikin data.
 * Pakai `prisma.$queryRaw` via klien RAW (bukan Proxy) supaya tidak rekursif.
 */
export async function tungguDB(prismaRaw: {
  store: { count(): Promise<number> };
}): Promise<void> {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      await withRetry(
        () => prismaRaw.store.count(),
        "preflight DB"
      );
      return;
    } catch (e) {
      if (attempt === RETRY_MAX) {
        throw new Error(
          `DB tidak terjangkau setelah ${RETRY_MAX} percobaan — pooler Neon ` +
            `sedang tidak stabil. Tunggu 15-20 detik lalu jalankan ulang. ` +
            `(${(e as Error)?.message ?? e})`
        );
      }
    }
  }
}
