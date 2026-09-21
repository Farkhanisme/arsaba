-- AlterTable: nominal jadi nullable
ALTER TABLE "Agenda" ALTER COLUMN "nominal" DROP NOT NULL;

-- AlterTable: tambah kolom audit nominal
ALTER TABLE "Agenda" ADD COLUMN "nominalSetAt" TIMESTAMP(3);
ALTER TABLE "Agenda" ADD COLUMN "nominalSetById" TEXT;

-- CreateIndex
CREATE INDEX "Agenda_nominalSetById_idx" ON "Agenda"("nominalSetById");

-- AddForeignKey
ALTER TABLE "Agenda" ADD CONSTRAINT "Agenda_nominalSetById_fkey" FOREIGN KEY ("nominalSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
