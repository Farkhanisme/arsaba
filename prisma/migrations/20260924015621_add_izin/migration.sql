-- CreateTable
CREATE TABLE "Izin" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tanggal" DATE NOT NULL,
    "alasan" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Izin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Izin_employeeId_tanggal_key" ON "Izin"("employeeId", "tanggal");
CREATE INDEX "Izin_employeeId_idx" ON "Izin"("employeeId");
CREATE INDEX "Izin_tanggal_idx" ON "Izin"("tanggal");

-- AddForeignKey
ALTER TABLE "Izin" ADD CONSTRAINT "Izin_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Izin" ADD CONSTRAINT "Izin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
