-- CreateEnum
CREATE TYPE "JenisAbsen" AS ENUM ('MASUK', 'KELUAR');

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_verifiedById_fkey";

-- DropIndex
DROP INDEX "Attendance_status_idx";

-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "fotoKeluarFileId",
DROP COLUMN "fotoMasukFileId",
DROP COLUMN "latitudeKeluar",
DROP COLUMN "latitudeMasuk",
DROP COLUMN "longitudeKeluar",
DROP COLUMN "longitudeMasuk",
DROP COLUMN "rejectedReason",
DROP COLUMN "status",
DROP COLUMN "verifiedAt",
DROP COLUMN "verifiedById",
ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoClosedAt" TIMESTAMP(3),
ADD COLUMN     "fotoKeluarDiambilPada" TIMESTAMP(3),
ADD COLUMN     "fotoMasukDiambilPada" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "statusKeluar" "StatusVerifikasi" NOT NULL DEFAULT 'PENDING_VERIFIKASI',
ADD COLUMN     "statusMasuk" "StatusVerifikasi" NOT NULL DEFAULT 'PENDING_VERIFIKASI';

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "jenis" "JenisAbsen" NOT NULL,
    "fotoFileId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "absenServerPada" TIMESTAMP(3) NOT NULL,
    "status" "StatusVerifikasi" NOT NULL DEFAULT 'PENDING_VERIFIKASI',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "keteranganKoreksi" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceLog_attendanceId_idx" ON "AttendanceLog"("attendanceId");
CREATE INDEX "AttendanceLog_jenis_idx" ON "AttendanceLog"("jenis");
CREATE INDEX "AttendanceLog_status_idx" ON "AttendanceLog"("status");
CREATE INDEX "Attendance_statusMasuk_idx" ON "Attendance"("statusMasuk");
CREATE INDEX "Attendance_statusKeluar_idx" ON "Attendance"("statusKeluar");
CREATE INDEX "Attendance_autoClosed_idx" ON "Attendance"("autoClosed");

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
