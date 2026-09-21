-- 1. Tabel counter kode user
CREATE TABLE "KodeCounter" (
  "prefix" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "KodeCounter_pkey" PRIMARY KEY ("prefix")
);

-- 2. Tambah kolom kode (nullable dulu, backfill di langkah 3)
ALTER TABLE "User" ADD COLUMN "kode" TEXT;

-- 3. Backfill kode untuk user existing
--    Prefix: DIREKTUR → DIR, MANAJER → MGR, lainnya → EMP.
--    Nomor urut per prefix berdasarkan createdAt.
WITH numbered AS (
  SELECT
    id,
    CASE
      WHEN role = 'DIREKTUR' THEN 'DIR'
      WHEN role = 'MANAJER'  THEN 'MGR'
      ELSE 'EMP'
    END AS prefix,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN role = 'DIREKTUR' THEN 'DIR'
          WHEN role = 'MANAJER'  THEN 'MGR'
          ELSE 'EMP'
        END
      ORDER BY "createdAt"
    ) AS num
  FROM "User"
)
UPDATE "User" u
SET kode = n.prefix || '-' || LPAD(n.num::text, 3, '0')
FROM numbered n
WHERE u.id = n.id;

-- 4. Set NOT NULL + UNIQUE untuk kode
ALTER TABLE "User" ALTER COLUMN "kode" SET NOT NULL;
CREATE UNIQUE INDEX "User_kode_key" ON "User"("kode");

-- 5. Seed counter dari data existing
INSERT INTO "KodeCounter" (prefix, "lastNumber")
SELECT
  SUBSTRING(kode FROM 1 FOR 3),
  MAX(CAST(SUBSTRING(kode FROM 5) AS INTEGER))
FROM "User"
GROUP BY SUBSTRING(kode FROM 1 FOR 3);

-- 6. Hapus kolom email + emailVerified + index uniknya
DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" DROP COLUMN "email";
ALTER TABLE "User" DROP COLUMN "emailVerified";
