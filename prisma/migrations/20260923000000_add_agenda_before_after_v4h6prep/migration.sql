-- Rename kolom buktiFileId menjadi buktiAfterFileId (preserve data)
ALTER TABLE "Agenda" RENAME COLUMN "buktiFileId" TO "buktiAfterFileId";

-- Tambah kolom buktiBeforeFileId (opsional)
ALTER TABLE "Agenda" ADD COLUMN "buktiBeforeFileId" TEXT;
