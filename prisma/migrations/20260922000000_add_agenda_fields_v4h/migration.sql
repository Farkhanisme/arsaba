-- AlterTable
ALTER TABLE "Agenda" ADD COLUMN     "buktiFileId" TEXT,
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "diselesaikanPada" TIMESTAMP(3),
ADD COLUMN     "templateId" TEXT;

-- CreateIndex
CREATE INDEX "Agenda_templateId_idx" ON "Agenda"("templateId");

-- CreateIndex
CREATE INDEX "Agenda_deadline_idx" ON "Agenda"("deadline");

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Agenda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
