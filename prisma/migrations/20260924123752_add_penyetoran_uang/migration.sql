-- Penyetoran uang antar toko & pusat (jejak transfer kas, by tanggal & pelaku).
-- v1: TIDAK terkait saldo kas / SalesRecord / omset Epos.
-- Catatan: enum JenisHariTemplate (dead schema, tak dipakai field mana pun) SENGAJA
-- tidak disertakan — drift pre-existing, di luar cakupan migrasi ini.

-- CreateEnum
CREATE TYPE "TujuanSetoran" AS ENUM ('TOKO', 'PUSAT');

-- CreateEnum
CREATE TYPE "StatusSetoran" AS ENUM ('MENUNGGU_KONFIRMASI', 'DITERIMA', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "JenisBuktiSetoran" AS ENUM ('SETOR', 'TERIMA');

-- CreateTable
CREATE TABLE "SetoranUang" (
    "id" TEXT NOT NULL,
    "dariStoreId" TEXT NOT NULL,
    "tipeTujuan" "TujuanSetoran" NOT NULL,
    "tokoTujuanId" TEXT,
    "nominalDisetor" INTEGER NOT NULL,
    "keterangan" TEXT,
    "status" "StatusSetoran" NOT NULL DEFAULT 'MENUNGGU_KONFIRMASI',
    "disetorkanOlehId" TEXT NOT NULL,
    "disetorkanPada" TIMESTAMP(3) NOT NULL,
    "nominalDiterima" INTEGER,
    "selisih" INTEGER,
    "keteranganSelisih" TEXT,
    "diterimaOlehId" TEXT,
    "diterimaPada" TIMESTAMP(3),
    "batalOlehId" TEXT,
    "batalPada" TIMESTAMP(3),
    "alasanBatal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SetoranUang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuktiSetoran" (
    "id" TEXT NOT NULL,
    "setoranId" TEXT NOT NULL,
    "jenis" "JenisBuktiSetoran" NOT NULL,
    "fileId" TEXT NOT NULL,
    "namaFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuktiSetoran_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetoranUang_dariStoreId_idx" ON "SetoranUang"("dariStoreId");

-- CreateIndex
CREATE INDEX "SetoranUang_tokoTujuanId_idx" ON "SetoranUang"("tokoTujuanId");

-- CreateIndex
CREATE INDEX "SetoranUang_tipeTujuan_idx" ON "SetoranUang"("tipeTujuan");

-- CreateIndex
CREATE INDEX "SetoranUang_status_idx" ON "SetoranUang"("status");

-- CreateIndex
CREATE INDEX "SetoranUang_disetorkanPada_idx" ON "SetoranUang"("disetorkanPada");

-- CreateIndex
CREATE INDEX "BuktiSetoran_setoranId_idx" ON "BuktiSetoran"("setoranId");

-- CreateIndex
CREATE INDEX "BuktiSetoran_jenis_idx" ON "BuktiSetoran"("jenis");

-- AddForeignKey
ALTER TABLE "SetoranUang" ADD CONSTRAINT "SetoranUang_dariStoreId_fkey" FOREIGN KEY ("dariStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetoranUang" ADD CONSTRAINT "SetoranUang_tokoTujuanId_fkey" FOREIGN KEY ("tokoTujuanId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetoranUang" ADD CONSTRAINT "SetoranUang_disetorkanOlehId_fkey" FOREIGN KEY ("disetorkanOlehId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetoranUang" ADD CONSTRAINT "SetoranUang_diterimaOlehId_fkey" FOREIGN KEY ("diterimaOlehId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetoranUang" ADD CONSTRAINT "SetoranUang_batalOlehId_fkey" FOREIGN KEY ("batalOlehId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuktiSetoran" ADD CONSTRAINT "BuktiSetoran_setoranId_fkey" FOREIGN KEY ("setoranId") REFERENCES "SetoranUang"("id") ON DELETE CASCADE ON UPDATE CASCADE;
