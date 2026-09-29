# AGENTS.md — Arsaba V2

> Compact instruction file for AI agents. Every line below answers "Would an agent likely miss this without help?" If yes, it's included. If not, it's left out.

## Commands (verified in this repo)

- `npm install` — install dependencies
- `npm run dev` — start Next.js dev server (Turbopack). **Verified**: starts in 792ms, auto-patches tsconfig.json.
- `npm run build` — build Next.js production app. Script tersedia di package.json.
- `npm run start` — start production build (`next start`). Script tersedia di package.json.
- `npm run lint` — run linter (`next lint`). Script tersedia di package.json.
- `npx prisma generate` — generate Prisma client. Harus ditempatkan setelah schema.model terdefinisi.
- **Setelah `prisma generate`: restart `npm run dev`** — proses dev (Turbopack) meng-cache modul `@prisma/client` di memori; model baru (mis. `Izin`) tidak terbaca sampai server di-restart (gejala: `prisma.<model>` undefined di runtime padahal client di disk sudah lengkap).
- `npx tsx <file>.ts` — jalankan script TypeScript standalone (di luar Next.js). **WAJIB** pakai `--env-file=.env` agar environment variables dari `.env` terbaca, karena Next.js otomatis load `.env` tapi `tsx` standalone tidak.

## Menjalankan script mandiri
- Script di folder `scripts/` atau ad-hoc `npx tsx <file>.ts` **harus** pakai flag `--env-file=.env` agar environment variables dari `.env` terbaca. Next.js otomatis load `.env` tapi `tsx` standalone tidak.
  Contoh: `npx tsx --env-file=.env scripts/test-telegram.ts`

## Stack & Architecture

- **Framework**: Next.js 16+ with App Router, TypeScript
- **ORM**: Prisma ORM; `prisma` commands above
- **Database**: PostgreSQL via Neon (free tier). **Never** use Sheets as source of truth; Sheets are write-only export (DB → Sheets).
- **Auth**: Auth.js (NextAuth) with RBAC validated on **every API route**, not just UI. Role-checked from session/JWT payload.
- **Payments / Free-tier only**: No paid services. Neon free-tier PostgreSQL, OneSignal free tier (≤10k subscribers), Telegram Bot API free.
- **WIB timezone**: All timestamps use Asia/Jakarta (WIB). No cross-timezone considerations beyond this.
- **Mobile/Desktop**: Capacitor.js (web wrapper) and Tauri (desktop wrapper). Single codebase — do not create separate mobile/desktop repos.
- **Scheduling**: Dijalankan melalui Vercel Cron Jobs untuk reminder absen, verifikasi SLA, generate shift — *catatan: integrasi ini belum diverifikasi fully di repo ini sebagai package terinstall, hanya sebagai konsep dari spec*.

## Directories & Ownership

- `/spesification/` — single source of truth: `SPESIFIKASI_SISTEM.md`. All "pending confirmation" items (§12) must be resolved before implementing related features.
- `/` — root of Next.js app (src layout follows Next.js conventions).
- Master data (stores, shift hours, products, commodities) **must not be hardcoded**. All must be configurable via UI/database and seeded per §4.1-§4.2 of the spec.

## RBAC & Security

- **Never** rely on UI-only role display. Every API route must validate the user's role from session/JWT.
- **Hierarki role** (dikonfirmasi pemilik proyek): `DIREKTUR > MANAJER > SUPERVISOR > ADMIN > KEPALA_TOKO > KARYAWAN`. Hanya role dengan rank lebih tinggi boleh menetapkan role orang lain — **kecuali** `MANAJER` ↔ `DIREKTUR` saling boleh (organisasi ini hanya punya 1 Manajer dan 1 Direktur). Implementasi: `RANK` + `PENGECUALIAN` + `bolehSetRole()` di `lib/rbac.ts`.
- **Selalu cek self-patch** di route yang mengubah user: `if (id === session.user.id) return 400`. Tanpa ini Supervisor bisa menaikkan role-nya sendiri jadi Manajer. `reset-password` dan `[id]/gaji` sudah punya guard ini — `PATCH /api/user/[id]` wajib ikut.
- **Sensitive PII** (NIK, tempat/tanggal lahir, alamat, kontak_darurat): read/edit untuk **Admin, Supervisor, dan Manajer**. `KEPALA_TOKO` & `KARYAWAN` hanya melihat nama, toko, role. (Keputusan pemilik proyek — jangan memperketat tanpa keputusan baru; Supervisor adalah operator lapangan yang butuh akses ini.)
- **Audit log** is mandatory for: salary changes, manual bonuses/penalties, verification outcomes (who approved/rejected + when + reason), master data changes (stores, business modules), **`nominal` bonus agenda**, dan **koreksi jam manual**.
- **Ada DUA cara mengubah angka jam kerja, dan jangan dicampur.** Keduanya menjawab pertanyaan berbeda:
  - `POST /api/absensi/[id]/koreksi-jam` — "berapa jam yang **dibayar** untuk hari ini?" → mengisi `totalMenitManual`. **Hanya tipe `JAM`**, maks 1440 menit, menolak saat payroll `LOCKED`.
  - `PATCH /api/absensi/[id]/override-keluar` — "kapan karyawan sebenarnya **pulang**?" → menulis `absenKeluar` + `totalMenitKerja`. Untuk semua tipe, dan **dilarang** menyentuh `totalMenitManual` (regresi di `scripts/uji-override-keluar.ts`).
  - Kalau admin memang perlu menambah jam kerja (mis. lembur yang lupa dicek-out), itu lewat `koreksi-jam` dengan alasan sendiri. Sengaja tidak otomatis dari `override-keluar`, supaya `totalMenitManual` selalu berarti "keputusan Manajer" dan jejaknya tidak kabur.
- **`override-keluar` punya tiga batas waktu** (route `app/api/absensi/[id]/override-keluar/route.ts`): keluar tidak boleh (1) lebih awal dari `absenMasuk`, (2) di masa depan + toleransi 5 menit, (3) lebih dari 24 jam dari `absenMasuk`. Batas `>` 24 jam — **tepat 24 jam boleh**, karena ada toko buka 24 jam (Arsaba Mart). Tanpa batas (1), `hitungTotalMenitKerja` mengembalikan 0 menit via `Math.max(0, …)` dan route membalas 200, jadi payslip menampilkan "0 menit" seolah itu hasil benar — lebih buruk daripada error.
- **Agenda yang DITUGASKAN ke karyawan harus sudah di-"Selesai" sebelum boleh disetujui.** Guard ada di `app/api/agenda/[id]/verify/route.ts` (approve → 409 kalau `diselesaikanPada === null`). Tanpa guard ini ada rantai: approve duluan → status `DIVERIFIKASI` → karyawan tekan "Selesai" kena 409 (`selesai/route.ts` hanya menerima PENDING) → `diselesaikanPada` tidak bisa diisi lagi → `payroll/generate` hanya menghitung agenda yang punya `diselesaikanPada`, jadi bonus **tidak pernah dibayar, di bulan mana pun, dan tidak ada jalur pemulihan**.
  - Cakupannya **hanya `targetEmployeeId !== null`**. Template master dan assignment ke toko tidak punya konsep "Selesai" (tidak ada karyawan yang menekan tombol itu) dan tidak memengaruhi gaji. Kalau ikut diblokir, alur yang tidak bermasalah ikut mati.
  - **Menolak tetap boleh** tanpa selesai — penolakan berarti tugas dibatalkan, bukan "sudah dikerjakan tapi tidak bisa dibayar".
- **JANGAN bungkus snapshot pre-test dengan `.catch(() => [])`.** Kalau koneksi DB putus saat mengambil daftar payroll/attendance yang sudah ada, array kosong akan dianggap "tidak ada data sebelumnya" dan cleanup akan MENGHAPUS data milik orang lain. Sudah pernah terjadi: satu test menghapus 9 payroll. Kalau snapshot gagal, test harus berhenti — bukan lanjut dengan asumsi kosong.
- **`POST /api/payroll/generate` itu GLOBAL** — memproses SEMUA karyawan aktif yang punya `tipePerhitunganGaji`, bukan cuma yang diuji. Test yang memanggilnya untuk periode yang belum ada akan membuat baris payroll untuk semua karyawan nyata. Cleanup per-user tidak akan menyentuhnya. Pola yang benar: snapshot `Payroll.id` untuk periode tersebut SEBELUM memanggil generate, lalu hapus yang tidak ada di snapshot (lihat `scripts/uji-agenda-selesai.ts`).
- **Setoran tunai punya unique index anti-duplikat**: `(dariStoreId, nominalDisetor, menitBucket)`. Kolom `menitBucket` diisi **trigger database**, dan di Prisma schema diberi **`@ignore`**. Tiga aturan yang tidak boleh dilanggar:
  - **JANGAN hapus `@ignore`.** Begitu kolom muncul di Prisma Client, `menitBucket` bisa dikirim manual dari client dan unique index bisa dilewati. Tesnya: hapus `@ignore`, lalu `npx tsc --noEmit` harus gagal.
  - **JANGAN ganti trigger jadi `@default`.** Kolom dengan DEFAULT masih bisa diisi client — penjaga unique index jadi bisa ditembus. Prisma juga tidak bisa menulis `GENERATED ALWAYS AS`; dia akan menghasilkan DEFAULT yang ditolak Postgres (`cannot use column reference in DEFAULT expression`, SQLSTATE 0A000).
  - **Kesengajaannya ketat**: dua setoran sah dengan nominal identik di menit yang sama DITOLAK. Kalau nanti terlalu ketat di lapangan, ubah `minute` → `day` di trigger + index, tanpa perubahan kode aplikasi.
- **Bukti setor boleh dibuka penerima yang berwenang.** `KEPALA_TOKO` dengan `storeId` yang cocok untuk setoran bertipe `TOKO` boleh melihat bukti **saat masih `MENUNGGU_KONFIRMASI`** — dari `MENUNGGU` `diterimaOlehId` masih null, jadi tanpa ini dia tidak bisa melihat bukti yang harus dia periksa. Aturan ini harus **salin persis** cabang `TOKO` di `app/api/setoran/[id]/terima/route.ts`; jangan buat sumber kebenaran kedua.
- **Data deletion**: Never hard-delete employees. Use status (`aktif`/`resign`/`nonaktif`) + `riwayat_penempatan` table for history. Gaji, absensi, laporan must remain intact for old stores. **Setiap perubahan `storeId` wajib menulis baris `RiwayatPenempatan`** (skema sudah ada; jangan andalkan seed).

## Attendance (Absensi)

- Check-in/out lewat **form web aplikasi** (bukan bot Telegram): kamera + geolokasi opsional -> foto di-forward ke Telegram sebagai storage, simpan `file_id`.
- **Role check ditegakkan di API**: `KARYAWAN`, `KEPALA_TOKO`, `SUPERVISOR`, `ADMIN` boleh absen. `MANAJER` & `DIREKTUR` tidak. Jangan andalkan guard UI saja.
- `Attendance.storeId` **nullable** -- Supervisor/Admin boleh absen tanpa toko. Kehadiran dihitung dari `tanggalShift` unik, **tidak terikat toko** (lensa fisik / `hariHadirFisik` sudah dihapus).
- `tanggalShift` diambil dari `jamMulai` shift APPROVED yang mencakup waktu check-in (jendela 4 jam sebelum `jamMulai` s/d `jamSelesai`). Check-in 02.00 Senin untuk shift Minggu 18.00-06.00 -> **terhitung hari Minggu**. Tanpa shift -> fallback tanggal kalender WIB.
- **Gate tanpa shift**: check-in ditolak 403 kecuali `User.bolehAbsenTanpaShift = true` (default `false`, checkbox di Master Karyawan).
- **Tolerance 5 menit** -- server menghitung **saran** `max(0, menit_telat - 5)` yang di-pre-fill di form verifikasi; admin tetap menginput angka final. `potongan = menitTelat x 1000` dihitung server.
- **Auto-close (>20 jam) mengisi `absenKeluar`** dengan `jamSelesai` shift (fallback `absenMasuk`) + `statusKeluar = DIVERIFIKASI` -- bukan `now` -- supaya `totalMenitKerja` tidak melebihi jadwal (penting untuk gaji tipe `JAM`) dan karyawan bisa langsung check-in lagi.
- Geolocation **informational only** -- lat/long mentah + link Google Maps, jangan hitung jarak.
- **Semua helper waktu-WIB & pencocokan shift ada di `lib/absensi.ts`.** Jangan duplikasi `WIB_OFFSET_MS` di page/komponen -- pakai `formatWaktuWIB` / `formatTanggalWIB` / `findShiftAcuan` / `findShiftAcuanBatch` / `saranMenitTelat` / `hitungPotongan` / `hitungTotalMenitKerja` / `hitungAbsenKeluarAutoClose`.
- Bot stores `file_id` (not temporary URLs). `/api/telegram/file/[fileId]` **wajib otorisasi**: pemilik record (karyawan/pengirim) atau role `SUPERVISOR/ADMIN/MANAJER`.
- **Regression test absensi** (3 script, semua pakai `--env-file=.env`):
  - `scripts/uji-absensi.ts` -- 34 assert, **tanpa server**: konversi WIB, toleransi 5 menit, `findShiftAcuan` (termasuk shift malam lintas tengah malam), atribusi `tanggalShift`, auto-close, gate `bolehAbsenTanpaShift`. Residu 0.
  - `scripts/uji-absensi-http.ts` -- 26 assert, **butuh `npm run dev` jalan di terminal lain**: guard RBAC check-in per role, gate shift 403, anti-IDOR `/riwayat`, otorisasi foto Telegram, `isPam` tidak ke-reset, verifikasi-absensi-sendiri 403.
  - `scripts/uji-laporan-kehadiran.ts` -- 29 assert, laporan kehadiran incl. grup "Tanpa Toko".
- **Cara menulis test yang benar (2 jebakan Telegram):**
  - **Foto uji harus JPEG yang VALID.** `new Uint8Array([1,2,3])` ditolak dengan `IMAGE_PROCESS_FAILED`, dan seluruh test gagal di jalur upload tanpa pernah menyentuh logika yang diuji. Pakai `fileBukti()` dari `scripts/uji-setoran-duplikat.ts` (fixture `scripts/fixtures/probe-1px.jpg`). Gejalanya: test gagal di mana pun yang memanggil upload, padahal kodenya tidak salah.
  - **Sebaliknya, `fileId` palsu di DB itu boleh** (mis. `"uji-bukti-xxx"`) selama tesnya hanya memeriksa **status otorisasi** (403 atau bukan), bukan isi file. Proxy `/api/telegram/file/[fileId]` memanggil Telegram sungguhan dan mengembalikan 500 untuk `file_id` palsu — itu bukan kegagalan otorisasi.
  - `scripts/uji-penyetoran-uang.ts` -- 40 assert, penyetoran uang (§4.5) incl. race terima-vs-batal.
  - `scripts/uji-setoran-duplikat.ts` -- 19 assert, **butuh `npm run dev`**: anti transfer ganda (unique index `(dariStoreId, nominalDisetor, menitBucket)`) — duplikat di menit sama -> 409 `SETORAN_DUPLIKAT` dan record tidak dibuat, menit berbeda / nominal berbeda / toko berbeda tetap boleh; trigger `menitBucket` terisi otomatis; dan bukti setor — `KEPALA_TOKO` tujuan boleh buka bukti saat `MENUNGGU_KONFIRMASI` (sebelum ada `diterimaOlehId`) tapi **tidak boleh** buka bukti toko lain.
  - `scripts/uji-gaji.ts` -- 36 assert, perhitungan gaji (`lib/gaji.ts`): rumus 3 tipe, floor per hari, validasi tarif wajib, normalisasi field, dan regresi P0-1 (HARIAN tidak boleh memakai `tarifPerJam`). Residu 0.
  - `scripts/uji-gaji-http.ts` -- 19 assert, **butuh `npm run dev`**: `PATCH /api/user/[id]/gaji` end-to-end — tarif wajib per tipe ditolak 400, nilai tak valid ditolak, audit log tertulis, dan RBAC (KARYAWAN 403 walau body-nya valid).
  - `scripts/uji-rbac-http.ts` -- 33 assert, **butuh `npm run dev`**: matriks `bolehSetRole`, hierarki ditegakkan server, guard self-patch, AuditLog, `RiwayatPenempatan` saat mutasi toko, dan PII tidak bocor ke audit log.
  - `scripts/uji-agenda-http.ts` -- 30 assert, **butuh `npm run dev`**: nominal agenda hanya untuk status `DIVERIFIKASI`, audit per perubahan (dengan `nilaiSebelum`), guard payroll `LOCKED` -> 409 tanpa mengubah data, propagate template hanya ke turunan terverifikasi, dan `nominal-batch` preview-vs-commit.
  - `scripts/uji-agenda-selesai.ts` -- 15 assert, **butuh `npm run dev`**: guard "harus selesai sebelum disetujui" — approve tanpa `diselesaikanPada` -> 409 dan status tidak berubah; setelah karyawan tekan "Selesai" -> approve 200 **dan bonusnya benar-benar masuk gaji**; **tolak tanpa selesai tetap boleh**; template master dan assignment ke toko tetap bisa diverifikasi (keduanya tidak punya konsep Selesai); `DITOLAK` tidak bisa di-approve ulang.
  - `scripts/uji-override-keluar.ts` -- 25 assert, **butuh `npm run dev`**: batas waktu `override-keluar` (keluar < masuk, masa depan, dan > 24 jam -> 400 tanpa menulis apa pun; **tepat 24 jam tetap boleh**), payroll `LOCKED` -> 409 dan `Attendance` tidak berubah, `AuditLog` dengan `nilaiSebelum`/`nilaiSesudah`, **regresi desain** (`totalMenitManual` tidak tersentuh), dan guard lama tidak regresi (sudah punya keluar -> 409, self -> 403, keterangan < 3 -> 400).
  - `scripts/uji-jam-http.ts` -- 27 assert, **butuh `npm run dev`**: koreksi jam manual §7.1a — ditolak untuk tipe `HARIAN`/`BULANAN` (400), `totalMenitKerja` asli tidak pernah berubah, batas 0-1440 menit, `alasan` min 5 karakter, audit per koreksi + pembatalan (`totalMenitManual: null`), payroll `LOCKED` -> 409 tanpa mengubah data, `floor` per hari (6 × 470 menit = 42 jam, bukan 47), dan **regresi perangkap PAM** (2 segmen di 1 tanggal: koreksi berlaku per record -> 13 jam, bukan 8 jam; dan `totalHariKerja` tetap 1).
  - `scripts/uji-lock-http.ts` -- 18 assert, **butuh `npm run dev`**: blocker lock payroll §7.1 — `statusMasuk` PENDING -> 409 (dengan jumlah, tanggal, dan link antrean), **regresi perangkap `statusKeluar`** (pending di status keluar TIDAK boleh memblokir), pending di periode lain tidak relevan, `DITOLAK` melepas dari blokir, `generate` melaporkan `belumTerverifikasi`, dan guard **tidak mengubah** `totalGaji`/`totalHariKerja`.
  - `scripts/uji-payroll-http.ts` -- 49 assert, **butuh `npm run dev`**: mekanisme revisi §7.1b (alasan wajib, hanya untuk `LOCKED`, `revisiKe` naik, `AuditLog` `aksi: "REVISI"`, `PATCH` tetap 403 saat `LOCKED`), re-sync `DRAFT` (angka ikut ter-update, field input manual **tidak** ditimpa), `LOCKED` di-skip + laporkan `selisihTotal`, dan regresi kedua halaman payroll (payslip & daftar) benar-benar merender data — bukan "Payroll tidak ditemukan" / "Daftar Payroll (0)".
  - `scripts/uji-promoql.ts` -- `npm run uji:promoql`, **butuh `npm run dev`**: memanggil 92 endpoint untuk mencari `PrismaClientValidationError` (field Prisma salah ketik). Lihat P0-6.
- **Login di skrip uji HTTP wajib dua tahap** (Auth.js v5): `GET /api/auth/csrf` dulu, baru POST `/api/auth/callback/credentials` dengan `csrfToken` + cookie yang sama. Tanpa itu server balas `?error=MissingCSRF`. Gunakan helper `login()` dari `scripts/http-test.ts` (sudah ada retry) -- jangan menyalin ulang ritualnya.
- **Neon pooler free-tier sering drop koneksi (P1001)** -- kalau muncul `Can't reach database server`, tunggu 15-20 detik lalu ulangi. Jangan diduga sebagai bug kode. Di route yang butuh beberapa query (mis. `/api/telegram/file/[fileId]`), pakai query **sequential + short-circuit**, bukan `Promise.all`.
- **Skrip regresi WAJIB pakai retry.** Semua skrip di `scripts/` membungkus PrismaClient dengan `dbClient()` dari `scripts/db-retry.ts` (retry + backoff hanya untuk error transient: P1001/P1008/ECONNRESET/dll — BUKAN P2002/P2025 yang itu bug logika) dan memanggil `await tungguDB(prismaRaw)` sebelum bikin data. Connection drop bisa terjadi di tengah skrip, bukan cuma di awal; tanpa retry suite gagal palsu dan cleanup terlipat sehingga meninggalkan residue. Contoh: `const prisma = dbClient(prismaRaw);`.
- **Cleanup harus di `finally`.** Sisa data uji di DB jauh lebih merepotkan daripada test yang gagal. `uji-absensi.ts` punya `bersihkan()` yang dipanggil dari blok `finally` + pesan SQL manual kalau gagal.
- **Residu harus dicek DUA cara**: (1) berdasarkan `id` yang skrip buat -- memastikan yang dihapus hilang, dan (2) berdasarkan **pola nama/kode** (`startsWith`) -- memastikan tidak ada orphan yang terpisah dari daftar id (mis. create yang gagal separuh jalan). Hanya (1) pernah dipakai dan skrip tetap melaporkan "residu 0" padahal 10 record uji tertinggal. Baseline DB saat ini: 13 user + 4 store + 9 payroll.

## Shifts (Shift)

- Shifts generated from store hours (§4.1) + registered employee count.
- System must support **different weekday/weekend patterns** (e.g., BGM Dieng has different weekday/weekend rules).
- **24-hour shifts** (e.g., Arsaba Mart) and **overlapping night shifts** (e.g., 18.00–06.00) must be represented correctly (start/end can cross midnight).
- Manual shift adjustment is allowed by Admin/Supervisor for special cases (e.g., Arsaba Mart "potong waktu kalau ada sesuatu"). Must be logged in audit log.

## PAM (Backup Karyawan)

- Triggered when an employee takes leave on a given store.
- Admin/Supervisor assigns backup from **other stores**.
- **PAM gate = `Store.pamEnabled`** (default `true`) — Admin can turn PAM off per store via UI. Ini **menggantikan** aturan ">3 karyawan" yang ada di versi spec sebelumnya; **jangan** mengimplementasikan ulang ambang jumlah karyawan. Saat toggle diubah, `AuditLog` wajib ditulis (nilai sebelum & sesudah `pamEnabled`).
- **Tidak ada kaitan otomatis izin → PAM.** Menandai izin di `Izin` tidak membuat atau menyarankan siapa yang backup. Admin/Supervisor yang menyusun jadwal penugasan. Ini gap yang diketahui (§12.3), bukan bug.
- **Gaji & kehadiran: global, bukan per toko.** `Payroll` tidak punya kolom store sama sekali. Kehadiran dihitung dari `tanggalShift` unik **tanpa filter toko**, jadi PAM di toko lain tetap terhitung keberangkatan. Lihat §5.3 & §7.1 di spesifikasi.
- **PAM jadi 2 segmen** (contoh: 07:00–12:00 dan 17:00–22:00) → **2 record `Attendance`**, masing-masing `totalMenitKerja` sendiri, tapi tetap **1 hari kerja** untuk `totalHariKerja`. `Attendance.isPam` diisi Manual/Supervisor saat verifikasi; `ShiftAssignment.segmen = "PAM"` hanya acuan menyusun jadwal.

## Agenda & Bonus (Agenda & Bonus)

- Two sources: **template_pusat** (central templates made by Manajer/Supervisor/Admin) and **mandiri_karyawan** (self-reported by employee).
- Both processed through **same verification & bonus alur**, but differentiated by `sumber` field for reporting.
- **Verification SLA**: end of the same day / end of Admin's shift. Pending items near SLA trigger OneSignal push reminder to the responsible Admin/Supervisor.
- If rejected: employee can resubmit (new record, old preserved in history).
- Each agenda has adjustable **nominal bonus** set by Manajer.

## Payroll & Gaji (Gaji & Payroll)

- **Gaji pokok** set by pusat (Manajer), not per store. Can differ per individual employee.
- **Tiga tipe perhitungan** (field `tipe_perhitungan_gaji` wajib ada di data karyawan):
  - `HARIAN` → `User.tarifPerHari × totalHariKerja`. **Rumus memakai tarif harian, bukan `tarifPerJam × 8`** — jam kerja beda per toko, jadi konstanta 8 tidak universal.
  - `JAM` → `User.tarifPerJam × jam_terbayar`, dengan `floor` **per hari** lalu dijumlah (§7.1a). Koreksi manual per hari disimpan di `Attendance.totalMenitManual`; `totalMenitKerja` asli tidak pernah diubah.
  - **JANGAN pakai `prisma.attendance.groupBy` untuk menghitung jam di payroll / estimasi dashboard.** `groupBy` menjumlahkan baris, jadi pada kasus PAM 2 segmen hasil koreksi manual ikut ter-total dan menit segmen lain hilang (480 + 300 menjadi 480 → 8 jam, seharusnya 13 jam). Ambil **per record** (`findMany`) lalu agregasi di JS: `Set` berisi `tanggalShift` untuk `totalHariKerja` (2 segmen = 1 hari) dan jumlahkan `jamTerbayarDariMenit(menitEfektif(record))` per record. Pola yang benar ada di `app/api/payroll/generate/route.ts` + `app/api/dashboard/gaji/route.ts` — keduanya harus identik.
  - `BULANAN` → `GajiPokok.nominal` tetap. **`GajiPokok.nominal` hanya dipakai tipe `BULANAN`** — jangan kirim field itu untuk tipe lain.
- **Jangan null-kan field tarif secara diam-diam.** Setiap field yang tidak relevan untuk tipe aktif dinormalkan ke `null`, dan field yang relevan **wajib** diisi (HARIAN wajib `tarifPerHari`, JAM wajib `tarifPerJam`, BULANAN wajib `nominalGajiPokok`) — kalau tidak, `baseGaji` diam-diam jadi 0.
- **Hanya kehadiran terverifikasi yang dibayar.** Hari izin & hari tanpa keterangan tidak menambah `totalHariKerja`/`totalMenitKerja` → tidak dibayar untuk `HARIAN` dan `JAM`; `BULANAN` tidak terpengaruh. **Tidak ada lembur** di model ini.
- **Bonuses**: Every completed & verified agenda adds its nominal to gaji. Manual bonuses/potongan by Manajer are recommended by system but final decision rests with Manajer before payroll is locked.
- **Sales performance bonus**: **Not calculated automatically** from sales data (confirmed by project owner). Provide a free-form nominal field + keterangan opsional in monthly payroll form, filled by Manajer based on personal assessment.
- **Payroll lock**: Sekali `LOCKED`, **tidak ada jalur edit langsung** (PATCH biasa tetap 403). Koreksi lewat **unlock dengan audit** (§7.1b): `POST /api/payroll/[id]/revise` dengan `alasan` wajib → status kembali `DRAFT`, `revisiKe` naik, `AuditLog` `aksi: "REVISI"`. `PATCH`/`generate` lalu bisa dipakai dan dikunci lagi.
- **Lock payroll MELEDAK 409 kalau masih ada absensi `PENDING_VERIFIKASI`** di (karyawan, periode) itu — pakai `absensiMenungguVerifikasi()` dari `lib/gaji.ts`. Alasannya: `generate` hanya menghitung `statusMasuk: "DIVERIFIKASI"`, jadi pending = hari kerja hilang dari gaji, dan tanpa guard payslip bisa terkunci sambil kehilangan hari itu.
  - **Hanya `statusMasuk` yang boleh memblokir.** `statusKeluar` yang pending **tidak boleh** memblokir (tidak masuk filter gaji, sudah terbayar, dan tidak ada jalan menutupnya tanpa log KELUAR → payslip terkunci selamanya). `DITOLAK` juga tidak memblokir — itu keputusan sadar, sudah "diselesaikan".
  - Ini pola yang mudah salah: dua kondisi (status masuk/keluar) kelihatan mirip, tapi efeknya berlawanan. `scripts/uji-lock-http.ts` mengunci perbedaan itu dengan assertion khusus.
- **Re-sync payroll**: `POST /api/payroll/generate` untuk payroll `DRAFT` yang sudah ada harus **menghitung ulang** angka otomatis (hari kerja, bonus agenda, potongan telat, total) tapi **tidak boleh menimpa** field input manual (`bonusManual`, `potonganManual`, `bonusPerforma`, `keteranganBonusPerforma`). Tanpa ini, agenda yang diverifikasi setelah generate hilang senyap.
- **Estimasi gaji dashboard**: Real-time from absensi, verified agenda, and recorded potongan. Label clearly as "estimasi" — final amount may change with manual bonus/potongan. **Rumus harus identik dengan `payroll/generate`** — pakai helper bersama, jangan tulis ulang (drift = estimasi ≠ payslip).
- **JANGAN panggil API sendiri dari Server Component pakai `fetch("/api/...")`.** Fetch relatif tidak punya base URL di Server Component Next.js, jadi request-nya tidak pernah sampai ke route. Kalau dibungkus `try { ... } catch {}` (pola lama di `manajer/payroll/[id]/page.tsx`), error-nya ditelan dan halamannya **selalu** jatuh ke state "tidak ditemukan" tanpa satu pun error di log. Di Server Component, query Prisma langsung; kalau bentuk datanya dipakai juga oleh API route, taruh mapper-nya di `lib/payroll-view.ts` (`petakanPayroll`) supaya keduanya tidak berbeda bentuk. `manajer/agenda/nominal/page.tsx` aman hanya karena file itu `"use client"`.

## Google Sheets Export

- **Sheets are never the source of truth** for operational data. They are a **single-write direction**: DB → Sheets.
- Export: every time penjualan/gaji/absensi finalisasi, write rekap to the appropriate sheet (one sheet per store per month).
- **Format**: simplified, do not faithfully replicate old Excel format (confirmed by project owner). One clear, consistent format for all stores/moduls — this is archive/reference read-only, not the primary workspace.
- **Do not read business logic from Sheets**. All reads must come from the database.

## Epos Integration (§4.2.1)

- **Epos** = external POS application already used by stores (not an internal term).
- **Current status**: integration details pending from project owner. Two paths exist:
  - **If Epos has API/auto-export**: pull daily sales rekap directly, store owner no longer inputs manually.
  - **If no API**: continue with manual rekap input (total omset, kas masuk-keluar from Epos readout), system serves as audit layer above existing data.
- **Current implementation path**: build the **manual input** route first with generic structure (`tanggal`, `toko`, `shift`, `saldo_awal`, `kas_masuk`, `kas_keluar`, `saldo_akhir`, `keterangan`, `sumber_data`: `manual`/`sinkron_epos`). This is swap-able later when Epos API is confirmed.

## Counter Dieng Module (§12, §4.2)

- Counter Dieng module specifics still being confirmed with project owner.
- As of now: assumed to sell **Pulsa/PPOB** products (same as §4.2.3), but detail produk list may differ. Do not hardcode the product list — make it configurable by Admin via master data UI.

## Open Questions / Pending (from §12)

1. **Epos integration detail** — wait for client answer before deciding auto-connector vs manual path.
2. **Counter Dieng produk** — being confirmed with client; produk list may match or differ from Pulsa/PPOB master.
3. After either of the above is resolved, revisit §4.2 and §11 accordingly.

## What to Avoid (anti-patterns)

- Hardcoding store names, shift hours, product lists, penalty amounts, or any master data that the spec says should be UI-configurable.
- Assuming client data is complete — many employee records have missing NIK/TTL/address at migration time. System must accept incomplete admin data with a UI indicator ("profil belum lengkap").
- Trusting client-submitted numbers for gaji, potongan, or kas rekonsiliasi. Always validate/recaculate on server.
- Silent overwrite of locked payroll data. Use revision mechanism with audit trail.
- Using Telegram `getFile` URL beyond a single request. Always re-fetch from `file_id` each time the photo is needed.

## Quick Test Shortcuts

- If adding a new store shift pattern: verify the system supports **weekday vs weekend differentiation** (BGM Dieng pattern) before assuming a simple 7-day repeat.
- If verifying attendance penalty: test the formula with exactly 5 min late (should be Rp0), 6 min late (Rp1000), 11 min late (Rp6000). Saran server sudah memperhitungkan toleransi 5 menit — `scripts/uji-absensi.ts` mengunci angka-angka ini.
- If verifying shift lintas tengah malam: check-in 02.00 Senin untuk shift Minggu 18.00-06.00 harus terhitung `tanggalShift` = Minggu (bukan Senin).
- If checking PAM: yang diuji adalah `Store.pamEnabled` (true = boleh, false = route assignment menolak dengan 400), **bukan** ambang jumlah karyawan. Aturan ">3 karyawan" sudah dihapus dari spesifikasi.
- If verifying perhitungan gaji tipe `JAM`: `floor` diterapkan **per hari** lalu dijumlah, bukan atas total menit sebulan — 6 hari × 470 menit = 42 jam, bukan 47. Koreksi manual per hari ada di §7.1a dan hanya berlaku saat payroll belum LOCKED.
- If verifying tipe `HARIAN`: hari izin dan hari tanpa keterangan **tidak dibayar** (tidak menambah `totalHariKerja`). Ini disengaja, bukan bug — lihat §7.1.

## Prisma — Migration & Format

- **Jangan pakai `prisma migrate dev`** — hanya gunakan `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` untuk preview SQL migration.
- **Buat folder migration secara manual** dengan timestamp: `mkdir -p prisma/migrations/<YYYYMMDDHHMMSS>_<nama_migration>` lalu buat file `migration.sql` di dalamnya (satu statement per baris, diakhiri titik koma).
- **Apply migration dengan `npx prisma migrate deploy`** (bukan `prisma migrate dev`).
- **`tanggalShift` di `Attendance` disimpan sebagai `@db.Date` (date-only), dihitung dari `shiftMulai` dalam zona WIB (Asia/Jakarta)** menggunakan helper `computeTanggalShiftWIB`. Jangan pernah menulis `tanggalShift: shiftMulai` langsung.
- **Jangan jalankan `prisma format` di sesi normal** — ia mereformat seluruh file dan mengotori `git blame`. Kalau perlu format, lakukan di commit chore terpisah tanpa perubahan substantif.
