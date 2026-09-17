-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DIREKTUR', 'MANAJER', 'SUPERVISOR', 'ADMIN', 'KEPALA_TOKO', 'KARYAWAN');

-- CreateEnum
CREATE TYPE "StatusKaryawan" AS ENUM ('AKTIF', 'RESIGN', 'NONAKTIF');

-- CreateEnum
CREATE TYPE "TipePerhitunganGaji" AS ENUM ('HARIAN', 'BULANAN');

-- CreateEnum
CREATE TYPE "SumberAgenda" AS ENUM ('TEMPLATE_PUSAT', 'MANDIRI_KARYAWAN');

-- CreateEnum
CREATE TYPE "StatusVerifikasi" AS ENUM ('PENDING_VERIFIKASI', 'DIVERIFIKASI', 'DITOLAK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'KARYAWAN',
    "status" "StatusKaryawan" NOT NULL DEFAULT 'AKTIF',
    "tipePerhitunganGaji" "TipePerhitunganGaji",
    "tanggalMasuk" TIMESTAMP(3),
    "nik" TEXT,
    "tempatLahir" TEXT,
    "tanggalLahir" TIMESTAMP(3),
    "alamat" TEXT,
    "kontakDarurat" TEXT,
    "storeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alias" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiwayatPenempatan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dariTokoId" TEXT,
    "keTokoId" TEXT NOT NULL,
    "tanggalPerpindahan" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alasan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiwayatPenempatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tanggalShift" TIMESTAMP(3) NOT NULL,
    "shiftMulai" TIMESTAMP(3) NOT NULL,
    "shiftSelesai" TIMESTAMP(3) NOT NULL,
    "absenWaktu" TIMESTAMP(3) NOT NULL,
    "menitTelat" INTEGER NOT NULL DEFAULT 0,
    "potongan" INTEGER NOT NULL DEFAULT 0,
    "fotoFileId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "StatusVerifikasi" NOT NULL DEFAULT 'PENDING_VERIFIKASI',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agenda" (
    "id" TEXT NOT NULL,
    "judul" TEXT NOT NULL,
    "deskripsi" TEXT,
    "nominal" INTEGER NOT NULL,
    "sumber" "SumberAgenda" NOT NULL,
    "targetStoreId" TEXT,
    "targetEmployeeId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "StatusVerifikasi" NOT NULL DEFAULT 'PENDING_VERIFIKASI',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GajiPokok" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GajiPokok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periode" TIMESTAMP(3) NOT NULL,
    "gajiPokok" INTEGER NOT NULL,
    "totalHariKerja" INTEGER,
    "totalBonusAgenda" INTEGER NOT NULL DEFAULT 0,
    "totalPotonganTelat" INTEGER NOT NULL DEFAULT 0,
    "bonusManual" INTEGER NOT NULL DEFAULT 0,
    "potonganManual" INTEGER NOT NULL DEFAULT 0,
    "bonusPerforma" INTEGER NOT NULL DEFAULT 0,
    "keteranganBonusPerforma" TEXT,
    "totalGaji" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tabel" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "aksi" TEXT NOT NULL,
    "nilaiSebelum" JSONB,
    "nilaiSesudah" JSONB,
    "actorId" TEXT NOT NULL,
    "alasan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRecord" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "shift" TEXT,
    "modul" TEXT NOT NULL,
    "sumberData" TEXT NOT NULL DEFAULT 'manual',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_nik_key" ON "User"("nik");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_storeId_idx" ON "User"("storeId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "RiwayatPenempatan_employeeId_idx" ON "RiwayatPenempatan"("employeeId");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_idx" ON "Attendance"("employeeId");

-- CreateIndex
CREATE INDEX "Attendance_storeId_idx" ON "Attendance"("storeId");

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- CreateIndex
CREATE INDEX "Agenda_sumber_idx" ON "Agenda"("sumber");

-- CreateIndex
CREATE INDEX "Agenda_status_idx" ON "Agenda"("status");

-- CreateIndex
CREATE INDEX "Agenda_targetStoreId_idx" ON "Agenda"("targetStoreId");

-- CreateIndex
CREATE INDEX "Agenda_targetEmployeeId_idx" ON "Agenda"("targetEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "GajiPokok_employeeId_key" ON "GajiPokok"("employeeId");

-- CreateIndex
CREATE INDEX "Payroll_periode_idx" ON "Payroll"("periode");

-- CreateIndex
CREATE INDEX "Payroll_status_idx" ON "Payroll"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_employeeId_periode_key" ON "Payroll"("employeeId", "periode");

-- CreateIndex
CREATE INDEX "AuditLog_tabel_recordId_idx" ON "AuditLog"("tabel", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "SalesRecord_storeId_tanggal_idx" ON "SalesRecord"("storeId", "tanggal");

-- CreateIndex
CREATE INDEX "SalesRecord_modul_idx" ON "SalesRecord"("modul");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiwayatPenempatan" ADD CONSTRAINT "RiwayatPenempatan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiwayatPenempatan" ADD CONSTRAINT "RiwayatPenempatan_dariTokoId_fkey" FOREIGN KEY ("dariTokoId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiwayatPenempatan" ADD CONSTRAINT "RiwayatPenempatan_keTokoId_fkey" FOREIGN KEY ("keTokoId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_targetStoreId_fkey" FOREIGN KEY ("targetStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_targetEmployeeId_fkey" FOREIGN KEY ("targetEmployeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GajiPokok" ADD CONSTRAINT "GajiPokok_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecord" ADD CONSTRAINT "SalesRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
