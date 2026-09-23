-- Add hariKerja column to ShiftTemplate
-- 0=Minggu, 1=Senin, ..., 6=Sabtu
-- Array kosong = SEMUA hari (backward compatible)

ALTER TABLE "ShiftTemplate" ADD COLUMN "hariKerja" integer[] DEFAULT '{}';

-- Update existing records to have empty array (SEMUA hari)
UPDATE "ShiftTemplate" SET "hariKerja" = '{}' WHERE "hariKerja" IS NULL;