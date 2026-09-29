-- P0-4 — Mekanisme revisi payroll (spesifikasi §7.1b).
--
-- MASALAH
--   `POST /api/payroll/generate` me-skip payroll yang sudah ada, dan
--   `PATCH /api/payroll/[id]` menolak saat LOCKED. Akibatnya payroll yang sudah
--   LOCKED TIDAK PERNAH bisa dikoreksi lagi — padahal spesifikasi §7.1:402
--   mewajibkan "mekanisme revisi yang tercatat, bukan edit langsung".
--
-- SOLUSI
--   1. `revisiKe`   = berapa kali payroll ini sudah direvisi.
--   2. `revisiAlasan` = alasan revisi terakhir (ditampilkan di payslip supaya
--      terlihat bahwa angka sudah pernah dikoreksi).
--
-- Kedua kolom ini hanya JEJAK. Mekanismenya ada di
-- `POST /api/payroll/[id]/revise` (unlock dengan audit), bukan di sini.

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "revisiAlasan" TEXT,
ADD COLUMN     "revisiKe" INTEGER NOT NULL DEFAULT 0;
