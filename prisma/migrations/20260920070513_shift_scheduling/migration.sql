-- CreateEnum
CREATE TYPE "StatusJadwal" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "SumberJadwal" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SegmenShift" AS ENUM ('NORMAL', 'PAM');

-- AlterEnum
ALTER TYPE "TipePerhitunganGaji" ADD VALUE 'JAM';

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "totalMenitKerja" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tarifPerJam" INTEGER;

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jamMulaiMenit" INTEGER NOT NULL,
    "jamSelesaiMenit" INTEGER NOT NULL,
    "lintasHari" BOOLEAN NOT NULL DEFAULT false,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftInstance" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "templateId" TEXT,
    "tanggal" DATE NOT NULL,
    "jamMulai" TIMESTAMP(3) NOT NULL,
    "jamSelesai" TIMESTAMP(3) NOT NULL,
    "statusJadwal" "StatusJadwal" NOT NULL DEFAULT 'DRAFT',
    "sumberJadwal" "SumberJadwal" NOT NULL,
    "catatan" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftInstanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "segmen" "SegmenShift" NOT NULL DEFAULT 'NORMAL',
    "jamMulai" TIMESTAMP(3) NOT NULL,
    "jamSelesai" TIMESTAMP(3) NOT NULL,
    "pamDariAssignmentId" TEXT,
    "pamKeterangan" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftTemplate_storeId_idx" ON "ShiftTemplate"("storeId");
CREATE UNIQUE INDEX "ShiftTemplate_storeId_nama_key" ON "ShiftTemplate"("storeId", "nama");
CREATE INDEX "ShiftInstance_storeId_tanggal_idx" ON "ShiftInstance"("storeId", "tanggal");
CREATE INDEX "ShiftInstance_statusJadwal_idx" ON "ShiftInstance"("statusJadwal");
CREATE INDEX "ShiftAssignment_shiftInstanceId_idx" ON "ShiftAssignment"("shiftInstanceId");
CREATE INDEX "ShiftAssignment_employeeId_idx" ON "ShiftAssignment"("employeeId");
CREATE INDEX "ShiftAssignment_segmen_idx" ON "ShiftAssignment"("segmen");

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftInstance" ADD CONSTRAINT "ShiftInstance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftInstance" ADD CONSTRAINT "ShiftInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftInstance" ADD CONSTRAINT "ShiftInstance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftInstance" ADD CONSTRAINT "ShiftInstance_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "ShiftInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
