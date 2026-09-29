-- Absensi tanpa toko: Supervisor/Admin bisa check-in tanpa terikat Store.
-- 1. Attendance.storeId jadi nullable (relasi ke Store jadi opsional).
-- 2. User.bolehAbsenTanpaShift: gate check-in saat tidak ada ShiftInstance APPROVED.
-- 3. Index AttendanceLog.fotoFileId untuk otorisasi proxy foto /api/telegram/file/[fileId].

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_storeId_fkey";

-- AlterTable
ALTER TABLE "Attendance" ALTER COLUMN "storeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bolehAbsenTanpaShift" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AttendanceLog_fotoFileId_idx" ON "AttendanceLog"("fotoFileId");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
