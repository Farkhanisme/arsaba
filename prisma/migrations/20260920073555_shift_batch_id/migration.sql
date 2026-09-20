-- AlterTable
ALTER TABLE "ShiftInstance" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "ShiftInstance_batchId_idx" ON "ShiftInstance"("batchId");
