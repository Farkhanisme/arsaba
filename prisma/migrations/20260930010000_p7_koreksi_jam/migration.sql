-- P0-7 — Koreksi jam kerja manual untuk karyawan tipe `JAM` (spesifikasi §7.1a).
--
-- MASALAH
--   `floor` untuk tipe JAM diterapkan atas TOTAL menit sebulan
--   (`floor(sum(menit)/60)`), sehingga sisa menit tiap hari hilang. Contoh:
--   6 hari x 7 jam 50 menit (470 menit) -> floor(2820/60) = 47 jam, padahal
--   6 x floor(470/60) = 42 jam. Selisih 5 jam per bulan.
--
--   Aturan yang disepakati: `floor` PER HARI lalu dijumlah, dan kasus yang
--   mendekati batas jam dikoreksi manusia lewat koreksi manual.
--
-- SOLUSI
--   1. `totalMenitManual` — nilai koreksi (null = pakai hitungan server).
--   2. `koreksiJamAlasan` / `koreksiJamOlehId` / `koreksiJamPada` — jejak audit.
--
-- CATATAN PENTING
--   - `totalMenitKerja` (hasil hitungan server) TIDAK diubah dan TIDAK dihapus,
--     supaya nilai aslinya selalu terlihat di rincian per hari.
--   - `totalMenitManual` NULLABLE tanpa DEFAULT, sama seperti `tarifPerHari`:
--     sengaja nullable supaya "belum ada koreksi" bisa dibedakan dari
--     "koreksi 0 menit".
--   - Berlaku per record Attendance (per segmen), bukan per tanggal.

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "koreksiJamAlasan" TEXT,
ADD COLUMN     "koreksiJamOlehId" TEXT,
ADD COLUMN     "koreksiJamPada" TIMESTAMP(3),
ADD COLUMN     "totalMenitManual" INTEGER;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_koreksiJamOlehId_fkey" FOREIGN KEY ("koreksiJamOlehId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
