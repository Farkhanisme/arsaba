# Spesifikasi Sistem — Aplikasi Absensi & Audit Penjualan Multi-Toko

> Dokumen ini adalah acuan tunggal (single source of truth) untuk AI/developer yang membangun aplikasi ini.
> Ikuti aturan di sini secara literal. Jika ada instruksi yang ambigu atau bertentangan dengan kebutuhan riil,
> **tanyakan ke pemilik proyek dulu, jangan menebak.**

---

## 1. Ringkasan Proyek

Aplikasi web (dengan turunan mobile & desktop) untuk:
1. Audit **absensi** karyawan di 10 toko.
2. Pencatatan & audit **penjualan/pembukuan harian** tiap toko (berbeda-beda tergantung jenis usaha toko).
3. Manajemen **shift**, **agenda/jobdesk**, dan **PAM (backup karyawan)**.
4. Perhitungan **estimasi gaji** otomatis dari data absensi, agenda, dan input manual manajer.
5. Verifikasi berjenjang untuk semua data yang diinput karyawan/kepala toko.

**Prinsip biaya: seluruh stack harus tetap 100% gratis** pada skala saat ini (10 toko, ±25 karyawan).
Jangan pilih layanan berbayar meskipun "trial gratis" — pilih yang free-tier permanen.

---

## 2. Stack Teknis (WAJIB diikuti)

| Komponen | Pilihan | Alasan |
|---|---|---|
| Framework web | Next.js (App Router) + TypeScript | Deploy native ke Vercel, satu codebase untuk web+API |
| Hosting | Vercel (Hobby/free plan) | Gratis, cukup untuk skala ini |
| Database utama | **PostgreSQL gratis via Neon** (pilihan final setelah komparasi — lihat catatan) | Untuk data transaksional: absensi, shift, gaji, agenda, penjualan. Jangan pakai spreadsheet sebagai database utama — hanya sebagai lapisan ekspor (lihat §2.1). Dipilih dibanding Sheets-sebagai-DB karena kebutuhan JOIN lintas tabel untuk gaji (absensi+agenda+potongan+PAM+bonus manual) jauh lebih aman & mudah di SQL; dipilih dibanding Firestore/Turso karena integrasi Vercel paling native dan cocok dengan pola data relasional proyek ini |
| ORM | **Prisma** (keputusan final, lihat §2.2) | Migrasi skema lebih aman, tipe otomatis |
| Autentikasi & RBAC | Auth.js (NextAuth) dengan role di session/JWT | RBAC **wajib dicek di server** (API route/middleware), jangan hanya di UI |
| Ekspor laporan | Google Sheets API (googleapis), satu arah dari DB → Sheets | Supaya tim tetap bisa buka Excel yang familiar |
| Penyimpanan gambar | Telegram Bot API (via `lib/telegram.ts`, dipanggil langsung dari API route — bukan webhook, lihat §10) | Server unggah gambar ke chat penyimpanan privat via `sendPhoto`, simpan `file_id` di database (tidak expired), jangan simpan URL `getFile` (expired cepat) |
| Push notification | OneSignal (free tier, hingga 10.000 subscriber) | Satu SDK untuk web + Capacitor (mobile) + webview Tauri (desktop), dashboard siap pakai |
| Scheduler | Vercel Cron Jobs | Untuk reminder absen, reminder verifikasi tertunda, generate shift otomatis |
| Mobile | Capacitor.js membungkus aplikasi web yang sama | Jangan buat codebase terpisah |
| Desktop | Tauri membungkus aplikasi web yang sama | Jangan buat codebase terpisah |

### 2.1 Aturan sinkronisasi Google Sheets
- Sheets **tidak pernah** menjadi sumber kebenaran (source of truth) untuk data operasional.
- Setiap kali data penjualan/gaji/absensi difinalisasi, sistem menulis rekap ke Sheet yang sesuai (satu sheet per toko per bulan).
- **Format ekspor disederhanakan, tidak perlu meniru format Excel lama secara identik** (dikonfirmasi pemilik proyek) — cukup satu format standar yang jelas dan konsisten untuk semua toko/modul, karena ini hanya sekadar arsip/referensi bacaan, bukan tempat kerja utama tim lagi.
- Kalau nanti ternyata ada kebutuhan format berbeda untuk toko/modul tertentu, penyesuaian dilakukan belakangan — bisa dari sisi struktur sheet ekspornya (template per modul) atau dari sisi query/agregasi di database, tanpa mengubah desain inti. Jangan desain sistem ekspor yang kaku/sulit diubah.
- Read dari Sheets **tidak boleh** dipakai untuk logika bisnis (hanya arah tulis: DB → Sheets).

### 2.2 Keputusan Stack yang Dikunci (jangan ditebak ulang oleh AI di sesi mana pun)

Supaya setiap sesi vibe-coding (model apa pun yang dipakai) tidak menebak ulang atau berubah-ubah pilihan teknis, keputusan berikut **final** dan wajib diikuti apa adanya:

| Keputusan | Nilai final |
|---|---|
| Package manager | **npm** |
| Framework | **Next.js (App Router)**, TypeScript wajib di semua file |
| ORM | **Prisma** (bukan Drizzle) |
| Database | **PostgreSQL via Neon (free tier)** |
| Auth | **Auth.js (NextAuth)** |
| Push notification | **OneSignal (free tier)** |
| Struktur folder | Mengikuti konvensi default Next.js App Router (`app/`, `lib/`, `prisma/`) — jangan buat struktur custom di luar itu tanpa alasan kuat |

**Aturan untuk AI/agent yang membaca dokumen ini:**
- Jangan menulis command konkret (`npm run dev`, `npx prisma generate`, dst.) di file instruksi apa pun (`AGENTS.md`, `CLAUDE.md`, dsb.) **sebelum** proyek benar-benar di-scaffold dan command tersebut bisa diverifikasi ada di `package.json`/lockfile repo.
- Setelah scaffold selesai, `AGENTS.md` harus diperbarui ulang berdasarkan isi repo yang sebenarnya (bukan disalin dari dokumen spesifikasi ini), dan dokumen spesifikasi ini tetap menjadi rujukan **rencana & aturan bisnis**, bukan rujukan command teknis.

| Role | Cakupan | Hak utama |
|---|---|---|
| **Direktur** | Semua toko | Lihat semua dashboard, laporan, tidak input data operasional harian |
| **Manajer** | Semua toko | Atur gaji pokok & bonus, lihat proyeksi payroll bulanan, buat template agenda, verifikasi tingkat atas |
| **Supervisor** | Semua toko | Audit penjualan, absensi, agenda; verifikasi absensi/agenda kepala toko & karyawan; assign PAM |
| **Admin** | Semua toko | Sama seperti supervisor + kelola master data (toko, jenis usaha per toko, karyawan, role, jam kerja) |
| **Kepala Toko** | Toko tempat ia ditugaskan | Input laporan penjualan toko, ajukan absensi/agenda seperti karyawan biasa (diperlakukan sebagai karyawan, role ini hanya label koordinasi) |
| **Karyawan** | Toko tempat ia ditugaskan | Absensi (foto+geolokasi), lihat/ajukan agenda, lihat estimasi gaji sendiri |

**Catatan:** Manajer, Supervisor, Admin mencakup **semua** 10 toko (bukan per wilayah) — sesuai konfirmasi pemilik proyek.

**Aturan RBAC teknis:**
- Semua endpoint API harus memvalidasi role dari session, bukan dari payload request.
- Log setiap perubahan data sensitif (gaji, bonus, potongan, hasil verifikasi) ke tabel `audit_log` — siapa, kapan, nilai sebelum/sesudah.

---

## 4. Master Data Toko

### 4.1 Daftar Toko & Jam Kerja

> Tabel ini adalah **input, bukan hardcode** — harus bisa diedit oleh admin lewat UI, tapi ini nilai awal yang harus di-seed.

| Toko | Shift & Jam | Catatan |
|---|---|---|
| **Arsaba Induk** | Pagi 06.30–16.30, Siang 11.00–21.00 | — |
| **Arsaba Mart** | Pagi 05.30–17.30, Tengah 10.00–20.00, Siang 13.00–24.00, 24 Jam 18.00–06.00 | Ada shift 24-jam yang overlap hari; jam bisa dipotong manual jika ada kondisi khusus |
| **Al Madad** | Pagi 06.00–16.00, Siang 10.00–20.00 | — |
| **Beras Wangi** | Pagi 06.00–17.00 | — |
| **Mie Ayam** | Pagi 07.15–17.15, Siang 10.00–20.00 | Toko/lokasi terpisah dari Beras Wangi (dikonfirmasi) |
| **Temanggung** | Pagi 05.30–13.00, Sore 17.00–21.30 | — |
| **BGM Dieng** | Weekday: Pagi 07.00–17.00, Siang 14.00–02.00. Weekend: Pagi 07.00–19.00, Siang 14.00–02.00, Malam 19.00–07.00 | Pola shift beda hari kerja vs akhir pekan — sistem generate shift harus bisa baca aturan berbeda per hari |
| **Counter Dieng** | Pagi 07.00–17.00, Sore 14.00–24.00, Malam 16.00–02.00 | Nama resmi di sistem: **Counter Dieng** (alias/nama lain yang mungkin muncul di data lama: "Arsaba Dieng" — keduanya merujuk toko yang sama, dikonfirmasi). Shift overlap **disengaja** — tujuannya agar tidak ada jeda toko kosong karyawan saat momen pergantian shift. Sistem harus mengizinkan dua karyawan absen aktif bersamaan di jam overlap (bukan dianggap anomali/error) |
| **Sambel Bakar** | Pagi 09.00–19.00 | Kepala toko: jam kondisional (fleksibel, tidak terikat shift baku) |
| **Dapur Produksi** | Tidak ada shift tetap — kerja **insidental/on-demand** saat dibutuhkan | Nama resmi di sistem: **Dapur Produksi** (alias/nama lain yang mungkin muncul di data lama: "Dapur Rumah" — keduanya merujuk lokasi yang sama, dikonfirmasi). Perlu tipe shift khusus "ad-hoc" yang tidak terikat template mingguan — admin/supervisor membuat penugasan kerja langsung per kebutuhan, bukan dari jadwal rutin |

### 4.2 Lini Usaha (Modul Pembukuan) per Toko

Reporting **tidak dibuat per toko**, tapi **per jenis usaha (modul)**. Admin yang menentukan kombinasi modul aktif di tiap toko lewat tabel relasi `toko_usaha` (many-to-many). Ketika kepala toko login, form input yang muncul otomatis menyesuaikan modul yang aktif di tokonya.

| Toko | Modul aktif (berdasarkan info yang diberikan) |
|---|---|
| Arsaba Induk | Epos, Saldo (kas masuk-keluar) |
| Arsaba Mart | Brilink, Epos, Bensin (Pertalite & Pertamax), Pulsa |
| Al Madad | Brilink, Epos, Pulsa |
| Beras Wangi | Brilink, Komoditas Harian (Beras), Komoditas Harian (Bakso Kriwil) |
| Mie Ayam | Penjualan Harian (format sederhana — lihat catatan §4.2.7) |
| Temanggung | Brilink, Epos, Pulsa, Komoditas Harian (Cilok) |
| BGM Dieng | Nota Harian (minimarket), Piutang, Aksesoris/Stok Barang |
| Counter Dieng | Pulsa/PPOB (kemungkinan besar, dikonfirmasi sementara oleh pemilik proyek — **detail modul spesifiknya masih perlu digali bareng**, lihat §12) |
| Sambel Bakar | Nota Harian (minimarket, per shift) |
| Dapur Produksi | Tidak ada modul penjualan (tidak berhadapan langsung dengan pelanggan/kas) — hanya perlu pencatatan penugasan kerja insidental untuk keperluan absensi & jobdesk, bukan laporan keuangan |

Daftar modul yang perlu dibangun:

#### 4.2.1 Modul Epos
**Dikonfirmasi: "Epos" adalah aplikasi kasir/POS eksternal yang sudah dipakai toko** (bukan istilah internal). **Status: masih menunggu konfirmasi dari client soal kemampuan integrasi Epos** (pemilik proyek akan menanyakan langsung). Sambil menunggu, dua pendekatan integrasi yang perlu didiskusikan lebih lanjut sebelum implementasi (lihat §12):
- **Jika Epos punya API atau fitur ekspor otomatis (CSV/webhook)**: sistem baru menarik data rekap penjualan harian langsung dari sana, kepala toko tidak perlu input ulang manual.
- **Jika tidak ada API/ekspor**: kepala toko tetap input rekap ringkasan harian secara manual ke sistem baru (total omset, kas masuk-keluar dari hasil baca aplikasi Epos), dan sistem baru berfungsi sebagai lapisan audit di atas data yang sudah ada di Epos.

Sambil menunggu kepastian, bangun dulu jalur **input manual** dengan struktur data yang cukup generik agar mudah diganti ke integrasi otomatis nanti tanpa migrasi besar:
`tanggal`, `toko`, `shift`, `saldo_awal`, `kas_masuk`, `kas_keluar`, `saldo_akhir`, `keterangan`, `sumber_data` (enum: `manual` / `sinkron_epos` — disiapkan sejak awal meski saat ini selalu `manual`).

#### 4.2.2 Modul Brilink (Agen Bank)
Berdasarkan pola file `PEMBUKUAN_BRILINK_*`:
- Transaksi setor/tarik per hari (jumlah transaksi, nominal masuk, komisi/ADM).
- Neraca berjalan: saldo EDC, saldo BRImo, kas fisik.
- Piutang & hutang (dengan keterangan bon).
- Modal awal vs modal sekarang → laba bersih harian.

Field: `tanggal`, `toko`, `jumlah_transaksi`, `nominal_masuk`, `komisi_adm`, `kas_keluar`, `saldo_edc`, `saldo_brimo`, `piutang`, `hutang`, `modal_awal`, `modal_sekarang`, `laba_bersih` (dihitung otomatis).

#### 4.2.3 Modul Pulsa/PPOB
Berdasarkan pola file `HARIAN_HP_DAN_DATA_DIENG`:
- Stok awal & akhir per jenis produk (Pulsa, Saldo, dan kategori agen seperti KT, MOBO, DIGIPOS, SIMPEL, DOMPUL, FAZZ AGEN — daftar ini harus **bisa ditambah oleh admin**, jangan di-hardcode karena tiap toko bisa beda produk).
- AU (uang fisik/kas terkait transaksi pulsa).
- Total penjualan per produk per hari.

Field: `tanggal`, `toko`, `produk` (relasi ke master produk PPOB), `stok_awal`, `stok_akhir`, `terjual` (dihitung), `nominal`.

#### 4.2.4 Modul Bensin
Berdasarkan `Sistem_Rekap_Toko_Bensin_V6-3.xlsx` (file paling terstruktur, jadikan acuan formula):
- Master harga: harga beli & harga jual per liter per jenis BBM (Pertalite, Pertamax), bisa diubah admin.
- Input harian: liter masuk (kulakan), liter keluar (terjual), cek fisik tangki malam hari, transfer/QRIS masuk, uang fisik di laci, pengeluaran toko, bon.
- Dihitung otomatis: total omset, selisih kas (fisik vs seharusnya), setoran bersih tunai, laba bersih, selisih stok (liter tercatat vs cek fisik), saldo kas berjalan (kumulatif harian → ringkasan bulanan).

Field: `tanggal`, `toko`, `jenis_bbm`, `liter_masuk`, `liter_keluar_pom`, `cek_fisik_malam`, `qris_masuk`, `kas_fisik`, `pengeluaran`, `bon`, lalu kolom turunan: `total_omset`, `selisih_kas`, `setoran_bersih`, `laba_bersih`, `selisih_stok`.

#### 4.2.5 Modul Nota Harian (Minimarket per Shift)
Berdasarkan pola `PEMBUKUAN_BGM_DIENG` / `PEMBUKUAN_SAMBAL_BAKAR` / `PENJUALAN_BGM_SEPTEMBER`:
- Transaksi bernomor nota per shift, dengan cash masuk & QRIS masuk.
- Pengeluaran/belanja per shift (nomor nota, jumlah, nama barang/keperluan, QRIS/cash).
- Rekonsiliasi kas: KAS awal, IN (masuk), OUT (keluar), jumlah kas fisik ("ADA UANG") vs seharusnya → selisih otomatis dihitung.
- Untuk BGM Dieng tambahan: pencatatan **piutang/hutang**, daftar **barang/aksesoris** di toko (stok), rekap **total piutang akhir bulan**, serta agregat **rata-rata laba** dan pencapaian laba/penghasilan bulanan.

Field inti: `tanggal`, `toko`, `shift`, `nomor_nota`, `cash_masuk`, `qris_masuk`, `pengeluaran_nominal`, `pengeluaran_keterangan`, `kas_awal`, `kas_akhir_fisik`, `selisih_kas` (dihitung).
Tambahan BGM Dieng: tabel `piutang` (nama, nominal, tanggal, status lunas/belum), tabel `stok_barang` (nama barang, kategori aksesoris, stok).

#### 4.2.6 Modul Komoditas Harian
Untuk item dengan pola jualan sederhana per hari: Beras Harian, Bakso Kriwil, Cilok. Ini bukan retail bernota, tapi lebih ke pencatatan kuantitas terjual x harga per hari.

Field: `tanggal`, `toko`, `komoditas` (relasi ke master komoditas — bisa ditambah admin), `qty_terjual`, `satuan`, `harga_satuan`, `total_omset` (dihitung), `modal`, `laba` (dihitung).

#### 4.2.7 Modul Penjualan Harian Sederhana (Mie Ayam)
Data yang diberikan untuk Mie Ayam masih umum ("pembukuan atau penjualan harian"). **Perlu dikonfirmasi** apakah ini cukup direpresentasikan sebagai Modul Komoditas Harian (qty x harga), atau butuh field pengeluaran/kas seperti Modul Nota Harian.

### 4.3 Master Data Karyawan

Berdasarkan file data karyawan yang diberikan client, field minimal untuk profil karyawan:

| Field | Sumber di file client | Catatan |
|---|---|---|
| `nama` | NAMA | Wajib |
| `tempat_lahir`, `tanggal_lahir` | TTL (digabung jadi satu kolom teks di file lama, misal "WONOSOBO, 12 FEBRUARI 2001") | Pecah jadi 2 field terpisah saat migrasi data, supaya bisa dipakai untuk validasi umur/kalkulasi lain nanti |
| `alamat` | ALAMAT | — |
| `nik` | NIK | **Data sensitif (PII)** — lihat aturan akses di bawah. Beberapa data existing kosong/tidak lengkap |
| `kontak_darurat` | KONTAK DARURAT | Muncul mulai sheet bulan Juli di file lama; jadikan field standar mulai sistem baru |
| `toko_id` (penempatan) | PENEMPATAN | Relasi ke tabel `toko`, bukan teks bebas — saat migrasi, cocokkan nama toko di file (ada variasi penulisan, lihat catatan §12) ke `toko_id` yang benar |
| `tanggal_masuk` | Sheet "AWAL MASUK" terpisah | Gabungkan ke profil karyawan sebagai satu field, bukan tabel terpisah seperti di file lama |
| `status` | *(tidak ada di file lama)* | Tambahkan field baru: `aktif` / `resign` / `nonaktif`, dipakai bersama `riwayat_penempatan` (§8) |
| `role` | *(tidak ada di file lama)* | Ditentukan saat setup akun di sistem baru: Direktur/Manajer/Supervisor/Admin/Kepala Toko/Karyawan |
| `tipe_perhitungan_gaji` | *(tidak ada di file lama)* | `HARIAN` / `BULANAN` — diisi manajer saat setup (§7.1) |

**Catatan migrasi data:**
- File lama berupa **snapshot roster per bulan** (tab "NEW MEI", "JULI NEW", "AGUSTUS NEW" masing-masing daftar karyawan bulan itu) — pola ini digantikan oleh `riwayat_penempatan` di sistem baru; tidak perlu mempertahankan format "satu tab per bulan".
- **Mapping alias nama toko saat migrasi** (dikonfirmasi pemilik proyek): "DAPUR RUMAH" → `Dapur Produksi`, "ARSABA DIENG" → `Counter Dieng`. Pastikan skrip migrasi mencocokkan varian penulisan ini (termasuk salah ketik seperti "ARSAA DIENG" dan "AL MADAD WIURI") ke `toko_id` yang benar, bukan membuat toko baru yang tidak sengaja terduplikasi.
- Banyak baris memiliki data tidak lengkap (NIK/TTL/alamat kosong, contoh: Zidan, Gufron Ali Imron, Sidiq) — **dikonfirmasi: kelengkapan data ini akan diinput menyusul oleh Admin**, bukan diminta ulang ke client. Sistem harus tetap bisa menyimpan karyawan dengan field opsional kosong sejak migrasi awal, dan menyediakan indikator di UI admin ("profil belum lengkap") supaya mudah dilacak siapa saja yang masih perlu dilengkapi. Jangan blokir input data operasional (absensi/gaji) karena field administratif ini kosong.
- **NIK, tanggal lahir, alamat, dan kontak darurat adalah data pribadi (PII)** — batasi akses lihat/edit hanya untuk Admin dan Manajer. Role lain (termasuk Supervisor) sebaiknya hanya melihat nama, toko, dan role, kecuali diputuskan lain oleh pemilik proyek.

### 4.4 Alur & Format Pengiriman Laporan Penjualan

**Keputusan penting**: laporan penjualan diinput lewat **form di aplikasi** (web/mobile), **bukan** lewat chat teks ke bot Telegram. Bot Telegram tidak pernah dipakai untuk interaksi langsung dengan karyawan sama sekali (lihat §10) — perannya murni sebagai backend penyimpanan gambar. Input angka laporan penjualan lewat chat teks bebas juga rawan salah — field numerik yang saling terhubung (kas awal/masuk/keluar/akhir, selisih, dst.) sulit divalidasi kalau diketik bebas. Form aplikasi bisa mencegah kesalahan ini sejak input (field wajib, validasi angka, kalkulasi otomatis langsung terlihat).

**Alur pengiriman (berlaku untuk semua toko & modul):**
1. Kepala Toko (atau karyawan yang ditugaskan) membuka form di akhir shift/hari. Toko otomatis terisi sesuai penempatannya, dan field yang muncul otomatis menyesuaikan modul usaha yang aktif di toko itu (§4.2) — bisa lebih dari satu modul sekaligus per toko.
2. Isi field sesuai modul (lihat tabel per modul di bawah). Field turunan (selisih kas, total omset, dsb.) dihitung otomatis di sisi aplikasi begitu field mentah diisi, supaya kesalahan ketahuan sebelum submit — **tapi tetap dihitung ulang di server saat submit**, jangan percaya angka turunan dari client (§11.2).
3. **Setiap laporan punya opsi upload foto bukti** (nota, struk, hasil cek fisik kas/tangki, dsb.) — opsional per submission, tidak wajib, tapi sangat dianjurkan terutama untuk modul dengan nilai besar (Bensin, Brilink) atau saat ada selisih kas. Foto diunggah lewat form aplikasi, lalu diteruskan server ke Telegram sebagai backend penyimpanan (§10) dan disimpan sebagai lampiran pada record laporan yang sama — foto absensi dan foto bukti laporan penjualan adalah dua record berbeda meski keduanya memakai mekanisme penyimpanan yang sama.
4. Submit → status `pending_verifikasi`. Sistem mengirim notifikasi push (OneSignal) ke Admin/Supervisor bahwa ada laporan baru menunggu verifikasi.
5. Admin/Supervisor mengecek kewajaran angka (bisa dibandingkan dengan foto bukti yang dilampirkan) sebelum batas waktu SLA (akhir hari itu / akhir jam kerja mereka, sesuai §6).
6. **Disetujui** → laporan terverifikasi, masuk ke rekap harian/bulanan toko, dipakai untuk dashboard, dan nantinya diekspor satu arah ke Google Sheets (§2.1).
7. **Ditolak** → Kepala Toko mendapat notifikasi dan bisa mengajukan ulang sebagai laporan baru; laporan yang ditolak tetap tersimpan di riwayat, tidak ditimpa (pola sama seperti agenda, §6).

**Penyimpanan foto bukti**: sama seperti foto absensi, foto lampiran laporan diunggah lewat form aplikasi lalu diteruskan server ke Telegram sebagai backend penyimpanan — simpan `file_id` yang dikembalikan Telegram, jangan simpan URL `getFile` yang sementara (§10).

**Format field per modul:**

*Epos* (status integrasi masih menunggu konfirmasi client, §4.2.1):
| Field | Keterangan |
|---|---|
| Saldo awal | Kas di awal shift |
| Kas masuk | Total pemasukan |
| Kas keluar | Total pengeluaran |
| Saldo akhir | Dihitung otomatis |
| Foto bukti | Opsional |
| Keterangan | Opsional |

*Brilink* (§4.2.2):
| Field | Keterangan |
|---|---|
| Jumlah transaksi | Total transaksi setor/tarik hari itu |
| Nominal masuk | Total uang masuk dari transaksi |
| Komisi (ADM) | Pendapatan komisi |
| Saldo EDC / Saldo BRImo | Saldo di masing-masing rekening |
| Piutang / Hutang | Kalau ada |
| Modal awal / Modal sekarang | Untuk hitung laba bersih otomatis |
| Foto bukti | Opsional |

*Pulsa/PPOB* (§4.2.3):
| Field | Keterangan |
|---|---|
| Produk | Pilih dari daftar produk (Pulsa, KT, MOBO, DIGIPOS, dst. — bisa ditambah Admin) |
| Stok awal / Stok akhir | Per produk |
| Terjual | Dihitung otomatis (awal − akhir) |
| Nominal | Total rupiah terjual |
| Foto bukti | Opsional |

*Bensin* (§4.2.4):
| Field | Keterangan |
|---|---|
| Jenis BBM | Pertalite / Pertamax |
| Liter masuk | Kulakan hari itu |
| Liter keluar (kasir) | Tercatat dari penjualan |
| Cek fisik tangki | Pengukuran manual malam hari |
| QRIS masuk / Kas fisik | Split metode pembayaran |
| Pengeluaran / Bon | Kalau ada |
| Foto bukti | Opsional, dianjurkan terutama saat ada selisih stok |

*Nota Harian — minimarket per shift* (§4.2.5):
| Field | Keterangan |
|---|---|
| Nomor nota | Per transaksi |
| Cash masuk / QRIS masuk | Split metode pembayaran |
| Pengeluaran (belanja) | Nominal + keterangan |
| Kas awal / Kas akhir fisik | Untuk hitung selisih otomatis |
| *(khusus BGM Dieng)* Piutang, stok barang/aksesoris | Tambahan pencatatan |
| Foto bukti | Opsional |

*Komoditas Harian* (§4.2.6/§4.2.7):
| Field | Keterangan |
|---|---|
| Komoditas | Pilih dari master (Beras, Bakso Kriwil, Cilok, dst.) |
| Qty terjual | Jumlah unit |
| Harga satuan | Per unit |
| Total omset | Dihitung otomatis |
| Modal / Laba | Opsional, dihitung otomatis kalau modal diisi |
| Foto bukti | Opsional |

### 5.1 Absensi
- Karyawan (Supervisor ke bawah, termasuk Kepala Toko) absen lewat foto + geolokasi.
- Geolokasi **hanya informasi pembantu** bagi verifikator — bukan syarat mutlak/blocking. Karyawan tetap bisa absen dari lokasi mana pun; sistem hanya menampilkan jarak dari toko sebagai referensi saat admin/supervisor memverifikasi.
- Foto diunggah lewat form di aplikasi, lalu diteruskan server ke Telegram sebagai backend penyimpanan (§10) — disimpan `file_id`, bukan URL sementara.
- Toleransi keterlambatan: **5 menit** dari jam mulai shift.
- Potongan keterlambatan: **Rp1.000 per menit** setelah toleransi terlampaui, berlaku untuk **semua karyawan tanpa kecuali**. Dihitung otomatis: `menit_telat = max(0, waktu_absen - jam_mulai_shift - 5 menit); potongan = menit_telat × 1000`.

### 5.2 Shift
- Shift bisa dibuat manual atau otomatis (per minggu/per hari).
- Auto-generate berdasarkan: jam buka/tutup per toko (§4.1) dan jumlah karyawan yang terdaftar di toko tersebut. Sistem harus mendukung pola jam kerja yang berbeda per hari dalam seminggu (contoh: BGM Dieng beda pola weekday vs weekend).
- Shift 24 jam (Arsaba Mart) dan shift yang overlap tengah malam (contoh 18.00–06.00) harus direpresentasikan dengan benar (jam mulai & jam selesai bisa lintas hari kalender).
- Admin/supervisor bisa memotong/menyesuaikan jam kerja shift secara manual untuk kondisi khusus (sesuai catatan Arsaba Mart: "bisa potong waktu kalau ada sesuatu").

### 5.3 PAM (Backup Karyawan)
- Dipicu ketika seorang karyawan izin/libur di suatu toko.
- Admin/supervisor menugaskan karyawan lain (dari toko mana saja) sebagai backup.
- **Konsep pembagian PAM**: shift kosong dibagi 2, masing-masing **5 jam**, diisi oleh (bisa) dua karyawan berbeda. Sistem harus mendukung satu slot shift kosong diisi oleh **lebih dari satu karyawan pengganti**, masing-masing dengan rentang jam sendiri.
- **Syarat toko yang bisa memakai PAM**: hanya toko dengan **lebih dari 3 karyawan terdaftar**. Toko dengan 3 karyawan atau kurang secara default tidak menampilkan opsi PAM otomatis (karena tidak ada karyawan cadangan yang wajar untuk ditarik tanpa mengosongkan toko asal).
- **Override**: Admin/Supervisor tetap bisa memaksa membuat penugasan PAM untuk toko dengan ≤3 karyawan jika situasinya mengharuskan (mengingat ini berdampak langsung ke pelayanan toko) — override ini harus tercatat di audit log (siapa yang override, toko mana, alasan opsional).
- **Pencatatan gaji/jam kerja PAM dicatat di toko asal karyawan yang izin**, bukan di toko yang dibantu (ini penting untuk laporan kinerja per toko vs biaya tenaga kerja).

---

## 6. Agenda & Bonus

- Manajer, Supervisor, dan Admin bisa membuat **template agenda** yang berlaku untuk semua toko & semua karyawan, atau menargetkan ke toko tertentu / karyawan tertentu.
- Setiap agenda punya **nominal bonus** yang bisa diatur (per agenda, ditentukan manajer).
- **Ada dua sumber agenda, keduanya sama-sama dihitung sebagai jobdesk berbonus setelah lolos verifikasi** (dikonfirmasi pemilik proyek):
  1. **Agenda default dari pusat** — dibuat dari template (Manajer/Supervisor/Admin), otomatis muncul sebagai tugas yang harus dikerjakan karyawan sesuai target (semua toko/toko tertentu/karyawan tertentu).
  2. **Agenda mandiri** — karyawan bisa melaporkan sendiri kegiatan/tugas yang ia kerjakan di luar agenda default pusat.
  - Model data: satu tabel `agenda` dengan field `sumber` (enum: `template_pusat` / `mandiri_karyawan`), supaya keduanya konsisten diproses lewat alur verifikasi & bonus yang sama, tapi tetap bisa dibedakan asalnya untuk laporan.
- Verifikasi berjenjang: agenda & absensi milik Kepala Toko dan Karyawan **wajib diverifikasi dulu** oleh Admin atau Supervisor sebelum dihitung ke gaji.
- **Batas waktu verifikasi (SLA)**: akhir hari itu juga / akhir jam kerja Admin-Supervisor yang bertugas hari itu. Jika mendekati batas waktu dan masih ada absensi/agenda berstatus `pending_verifikasi`, sistem mengirim reminder push ke Admin/Supervisor yang berwenang (lihat §9).
- Jika ditolak, karyawan bisa mengajukan ulang (resubmit), status sebelumnya tetap tersimpan di riwayat (jangan overwrite, buat record baru yang mereferensikan pengajuan sebelumnya).

---

## 7. Gaji & Payroll

### 7.1 Aturan Dasar
- **Gaji pokok ditentukan oleh pusat** (Manajer), bukan per toko — disimpan di level karyawan atau level role, bisa berbeda per individu.
- Siklus pembayaran: **bulanan**, tapi **perhitungan berbeda per karyawan**:
  - Ada karyawan yang dihitung **harian** (gaji = rate harian × jumlah hari kerja aktual bulan itu).
  - Ada karyawan yang dihitung **bulanan** (gaji pokok tetap, disesuaikan potongan/tambahan).
  - Field `tipe_perhitungan_gaji` (enum: `HARIAN` / `BULANAN`) wajib ada di data karyawan.
- Setiap jobdesk/agenda yang diselesaikan (dan sudah lolos verifikasi) menambah nominal ke gaji sesuai nominal yang diatur per agenda/jobdesk.
- Potongan keterlambatan (§5.1) otomatis dikurangkan.
- **Bonus dan potongan tambahan diinput manual oleh manajer**, berdasarkan data absensi dan agenda yang sudah terverifikasi — sistem menyediakan rekomendasi/rincian otomatis (total telat, total agenda selesai, dll), tapi keputusan akhir nominal tetap di tangan manajer sebelum payroll di-lock per bulan.
- **Bonus performa penjualan toko (khususnya untuk Kepala Toko) diinput manual sepenuhnya oleh manajer** — sistem **tidak menghitung otomatis** bonus jenis ini dari data penjualan (dikonfirmasi pemilik proyek). Cukup sediakan satu field nominal bebas di form payroll bulanan, dengan kolom keterangan opsional, yang diisi manajer berdasarkan penilaiannya sendiri terhadap performa toko.
- Setelah payroll bulanan di-lock oleh manajer, data itu **tidak boleh diubah lagi** tanpa jejak audit (buat mekanisme "revisi" yang tercatat, bukan edit langsung).

### 7.2 Dashboard Estimasi Gaji
- Direktur s/d Admin: dashboard lintas toko (total estimasi payroll semua toko bulan berjalan).
- Karyawan, Supervisor, Admin (sebagai individu): dashboard pribadi yang menampilkan **estimasi gaji berjalan** bulan ini — dihitung real-time dari absensi, agenda terverifikasi, dan potongan yang sudah tercatat. Beri label jelas bahwa ini "estimasi", karena bonus/potongan manual manajer bisa mengubah angka final.

---

## 8. Riwayat, Audit, & Data Historis

- **Audit log** wajib untuk: perubahan gaji pokok, bonus/potongan manual, hasil verifikasi (siapa approve/reject, kapan, alasan), perubahan master data toko/usaha.
- **Riwayat mutasi/resign karyawan**: karyawan yang pindah toko atau berhenti tidak dihapus dari database — beri status (`aktif`/`resign`/`nonaktif`) dan simpan histori penempatan toko (tabel `riwayat_penempatan`) supaya data historis (gaji, absensi, laporan) tetap utuh untuk toko lama.
- **Jenis izin**: `acara_pribadi`, `sakit` (bisa ditambah admin jika perlu jenis lain nanti).

---

## 9. Notifikasi & Reminder

- Gunakan **OneSignal free tier** untuk push notification lintas web, mobile (Capacitor), dan desktop (Tauri via web push).
- Reminder yang perlu dibangun (via Vercel Cron):
  - Reminder belum absen mendekati/lewat jam mulai shift.
  - Reminder ke admin/supervisor saat ada absensi/agenda menunggu verifikasi (terutama jika sudah lewat SLA tertentu — **tentukan durasi SLA ini, misal 24 jam, dengan admin**).
  - Reminder shift besok/mendatang.
  - Notifikasi hasil verifikasi (diterima/ditolak) ke karyawan bersangkutan.

---

## 10. Telegram Sebagai Media Penyimpanan Gambar

**Klarifikasi penting (dikonfirmasi pemilik proyek)**: karyawan **tidak pernah** berinteraksi langsung dengan bot Telegram (tidak chat, tidak kirim foto ke bot secara manual). Semua upload foto — foto absensi (§5.1) **maupun** foto bukti laporan penjualan (§4.4), dan fitur upload gambar lain yang mungkin ditambahkan di masa depan — dilakukan lewat **form di aplikasi** (web/mobile). Telegram murni dipakai sebagai **backend penyimpanan gambar gratis**, bukan sebagai antarmuka percakapan dengan pengguna.

**Alur teknis:**
1. Karyawan/kepala toko mengunggah foto lewat form di aplikasi (misal form absensi atau form laporan penjualan).
2. API route Next.js yang menerima upload tersebut memanggil fungsi utilitas server-side (`lib/telegram.ts`) yang menggunakan Telegram Bot API method `sendPhoto` (atau `sendDocument` jika ingin kualitas penuh tanpa kompresi otomatis Telegram) untuk mengunggah gambar ke satu **chat/grup privat khusus penyimpanan** — sebuah grup Telegram tempat bot ini dijadikan admin, dibuat khusus untuk keperluan ini (bukan chat personal siapa pun).
3. Telegram membalas dengan `file_id` di response API — **inilah yang disimpan ke database** terkait record yang bersangkutan (absensi atau laporan penjualan), bukan URL sementara dari `getFile`.
4. Saat gambar perlu ditampilkan kembali di dashboard, server memanggil Telegram `getFile` dengan `file_id` yang tersimpan untuk mendapatkan link sementara — **jangan pernah simpan/cache link sementara ini**, ambil ulang setiap kali dibutuhkan.
5. **Tidak diperlukan webhook masuk dari Telegram** untuk alur ini — semua komunikasi ke Telegram bersifat satu arah (aplikasi memanggil API Telegram), karena tidak ada interaksi chat dua arah dengan pengguna. Logic ini cukup berupa fungsi utilitas biasa di dalam Next.js (`lib/telegram.ts`), dipanggil dari API route mana pun yang menangani upload gambar — bukan proses/service terpisah.
6. Env var yang dibutuhkan: `TELEGRAM_BOT_TOKEN` (didapat dari BotFather) dan `TELEGRAM_STORAGE_CHAT_ID` (id grup/channel privat tempat bot mengunggah semua gambar).

---

## 11. Aturan Umum untuk AI yang Membangun Aplikasi Ini

1. **Jangan pernah hardcode** data master (daftar toko, jam kerja, daftar produk pulsa, daftar komoditas, nominal potongan/toleransi) — semua harus bisa diubah admin lewat UI/database, meskipun nilai awal di-seed sesuai §4.1 dan §4.2.
2. **Validasi & hitung ulang di server**, jangan percaya angka dari client (terutama untuk perhitungan gaji, potongan, dan rekonsiliasi kas).
3. **Setiap fitur yang menyentuh uang (gaji, kas, laba)** harus punya jejak audit dan tidak boleh silent-overwrite.
4. **RBAC ditegakkan di setiap API route**, bukan hanya menyembunyikan tombol di UI.
5. Struktur database harus **modular per jenis usaha** (§4.2) — hindari satu tabel `penjualan` generik yang mencoba menampung semua jenis usaha sekaligus; gunakan tabel terpisah per modul yang saling terhubung lewat `toko_id` dan `tanggal`, lalu satu tabel ringkasan (`ringkasan_harian_toko`) untuk agregasi ke dashboard.
6. Semua timestamp memakai **WIB (Asia/Jakarta)** — belum ada toko lintas zona waktu.
7. Jangan pilih library atau layanan yang mengharuskan pembayaran (termasuk paket "starter" berbayar) — cek dulu apakah ada alternatif free-tier permanen.
8. Jika instruksi di dokumen ini ambigu (ditandai "perlu dikonfirmasi" di atas), AI harus membuat implementasi yang **mudah diubah nanti** (jangan desain kaku di sekitar asumsi yang belum pasti), dan menandai di kode/komentar bagian mana yang berdasarkan asumsi.

---

## 12. Asumsi & Pertanyaan Terbuka (masih tersisa, per diskusi terakhir)

Sebagian besar poin di versi sebelumnya sudah terjawab (lihat riwayat perubahan §4, §6, §7, §2). Sisa yang masih perlu digali sebelum/selama development:

1. **Detail integrasi Epos**: sedang ditanyakan pemilik proyek ke client — tunggu jawaban sebelum memutuskan apakah modul Epos (§4.2.1) perlu konektor otomatis atau cukup form manual.
2. **Modul spesifik Counter Dieng**: sedang dikonfirmasi pemilik proyek ke client — field/produk spesifik yang dijual di sana (apakah sama dengan daftar produk Pulsa/PPOB di §4.2.3 atau ada tambahan/pengurangan) menyusul setelah ada jawaban.

---

*Dokumen ini sudah mencakup jawaban dari dua putaran diskusi. Perbarui bagian §12 setiap kali ada jawaban baru, dan revisi bagian terkait di atas.*
