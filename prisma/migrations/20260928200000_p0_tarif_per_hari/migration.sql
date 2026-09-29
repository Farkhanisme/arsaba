-- P0-1 — Gaji HARIAN memakai tarif harian.
--
-- MASALAH YANG DIPERBAIKI
--   `payroll/generate` menghitung baseGaji tipe HARIAN sebagai
--   `tarifPerJam * 8 * totalHariKerja`, sementara `PATCH /api/user/[id]/gaji`
--   memaksa `tarifPerJam = null` untuk semua tipe selain JAM. Akibatnya
--   baseGaji = 0 * 8 * hari = 0 untuk SEMUA karyawan tipe HARIAN begitu
--   Manajer menyentuh form gaji. Bug ini tersembunyi karena prisma/seed.ts
--   menulis tarifPerJam langsung (melewati API).
--
-- SOLUSI
--   1. Tambah User.tarifPerHari (dipakai HANYA saat tipe = HARIAN).
--   2. Backfill dari tarifPerJam x 8 untuk data existing.
--
-- CATATAN
--   - Kolom sengaja NULLABLE tanpa DEFAULT: karyawan HARIAN tanpa tarif harus
--     terdeteksi, bukan diam-diam jadi 0.
--   - `x 8` di backfill hanya ASUMSI untuk data seed, bukan aturan bisnis
--     (§7.1: jam kerja berbeda per toko). Manajer wajib memverifikasi
--     angkanya lewat /manajer/gaji.
--   - Statement CreateEnum di bawah BUKAN bagian P0-1: itu pre-existing drift.
--     Enum `JenisHariTemplate` didefinisikan di schema tapi tidak pernah
--     dipakai field mana pun (`ShiftTemplate.hariKerja` bertipe Int[]), dan
--     belum pernah dibuat di database. Dismasukkan agar migration ini
--     konsisten dengan datamodel, sehingga `prisma migrate diff` bersih
--     sesudahnya.

-- CreateEnum
CREATE TYPE "JenisHariTemplate" AS ENUM ('SEMUA', 'WEEKDAY', 'WEEKEND', 'KUSTOM');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "tarifPerHari" INTEGER;

-- Backfill data existing: 15.000 x 8 = 120.000 ; 17.500 x 8 = 140.000
UPDATE "User" SET "tarifPerHari" = COALESCE("tarifPerJam", 0) * 8
 WHERE "tipePerhitunganGaji" = 'HARIAN' AND "tarifPerJam" IS NOT NULL;
