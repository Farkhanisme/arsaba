-- Anti transfer ganda pada setoran tunai
--
-- MASALAH
--   Tabel "SetoranUang" tidak punya satu pun unique index. Endpoint
--   `POST /api/setoran` membuat record secara unconditional, jadi request yang
--   sama yang terkirim dua kali (double-click, retry setelah timeout, dua tab,
--   atau form yang di-resend) menghasilkan DUA record MENUNGGU_KONFIRMASI
--   dengan nominal sama. Setelah keduanya dikonfirmasi, uang terhitung dua kali
--   di pusat.
--
-- SOLUSI
--   Unik per (toko pengirim, nominal, menit pengiriman). Cukup untuk menolak
--   retry beberapa detik dari client yang sama, tanpa menahan dua setoran sah
--   yang dilakukan pada hari berbeda.
--
-- MENGAPA TRIGGER, BUKAN DEFAULT
--   Kolom idealnya `GENERATED ALWAYS AS (date_trunc('minute', "disetorkanPada"))`.
--   Dua alasan kenapa itu tidak dipakai:
--
--   1. Prisma tidak memodelkan generated column sama sekali. Generate
--      `@default(dbgenerated(...))` selalu menghasilkan DEFAULT biasa, dan
--      Postgres menolak: `cannot use column reference in DEFAULT expression`
--      (SQLSTATE 0A000).
--
--   2. Kolom dengan DEFAULT bisa diisi manual dari sisi client lewat `data: {}`,
--      sehingga unique index bisa dilewati. Trigger tidak bisa ditembus begini —
--      satu-satunya jalan untuk mengisinya adalah INSERT dari database.
--
-- CATATAN
--   Batasan yang sengaja: dua setoran sah dengan nominal identik di menit yang
--   sama akan ditolak. Kalau nanti terlalu ketat di lapangan, ubah `minute`
--   menjadi `day` di trigger dan di unique index — tidak ada perubahan kode
--   aplikasi.
--
--   Kalau `disetorkanPada` di-UPDATE nanti, trigger tetap menyimpan bucket yang
--   konsisten karena selalu dihitung ulang dari nilai baris saat itu.

-- AlterTable — kolom nullable dulu supaya baris lama yang sudah ada tidak
-- bentrok (tabel saat ini kosong, tapi migration harus aman kalau dijalankan
-- ulang di DB yang sudah berisi data).
ALTER TABLE "SetoranUang" ADD COLUMN "menitBucket" TIMESTAMP(3);

-- Backfill baris yang sudah ada. WHERE protects against re-run: baris yang
-- sudah punya nilai tidak ditimpa.
UPDATE "SetoranUang"
   SET "menitBucket" = date_trunc('minute', "disetorkanPada")
 WHERE "menitBucket" IS NULL;

-- Trigger: isi bucket menit pada INSERT. Setelah ini, kolom TIDAK LAGI bisa
-- diisi dari client — jadi unique index jadi tidak bisa dilewati.
CREATE OR REPLACE FUNCTION setoran_isi_menit_bucket()
RETURNS TRIGGER AS $$
BEGIN
  NEW."menitBucket" := date_trunc('minute', NEW."disetorkanPada");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_setoran_menit_bucket_ins
  BEFORE INSERT ON "SetoranUang"
  FOR EACH ROW
  EXECUTE FUNCTION setoran_isi_menit_bucket();

-- Trigger yang sama untuk UPDATE, supaya bucket selalu sinkron dengan
-- disetorkanPada bila baris itu pernah diubah.
CREATE OR REPLACE TRIGGER trg_setoran_menit_bucket_upd
  BEFORE UPDATE ON "SetoranUang"
  FOR EACH ROW
  EXECUTE FUNCTION setoran_isi_menit_bucket();

-- Sekarang kolom boleh NOT NULL: trigger menjamin terisi di setiap INSERT.
ALTER TABLE "SetoranUang" ALTER COLUMN "menitBucket" SET NOT NULL;

-- CreateIndex
CREATE INDEX "SetoranUang_menitBucket_idx" ON "SetoranUang"("menitBucket");

-- CreateIndex — inti anti transfer ganda.
CREATE UNIQUE INDEX "SetoranUang_dariStoreId_nominalDisetor_menitBucket_key"
  ON "SetoranUang"("dariStoreId", "nominalDisetor", "menitBucket");
