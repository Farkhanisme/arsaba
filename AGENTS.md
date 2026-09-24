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
- **Sensitive PII** (NIK, tempat/tanggal lahir, alamat, kontak_darurat): restrict read/edit to **Admin** and **Manajer** only. Other roles (Supervisor, Kepala Toko, Karyawan) should see name, toko, role only.
- **Audit log** is mandatory for: salary changes, manual bonuses/penalties, verification outcomes (who approved/rejected + when + reason), master data changes (stores, business modules).
- **Data deletion**: Never hard-delete employees. Use status (`aktif`/`resign`/`nonaktif`) + `riwayat_penempatan` table for history. Gaji, absensi, laporan must remain intact for old stores.

## Attendance (Absensi)

- Employees clock in via **photo + geolokasi** sent to Telegram bot.
- **Tolerance**: 5 menit from shift start. After that: **Rp1.000 per minute penalty**.
- Penalty formula: `menit_telat = max(0, absen_waktu - shift_mulai - 5 menit); potongan = menit_telat × 1000`.
- Geolocation is **informational only** for verifier — do not block absen based on distance.
- Bot stores `file_id` (not temporary URLs). When displaying photo in dashboard, call Telegram `getFile` with stored `file_id` each time — do not cache the temporary link.

## Shifts (Shift)

- Shifts generated from store hours (§4.1) + registered employee count.
- System must support **different weekday/weekend patterns** (e.g., BGM Dieng has different weekday/weekend rules).
- **24-hour shifts** (e.g., Arsaba Mart) and **overlapping night shifts** (e.g., 18.00–06.00) must be represented correctly (start/end can cross midnight).
- Manual shift adjustment is allowed by Admin/Supervisor for special cases (e.g., Arsaba Mart "potong waktu kalau ada sesuatu"). Must be logged in audit log.

## PAM (Backup Karyawan)

- Triggered when an employee takes leave on a given store.
- Admin/Supervisor assigns backup from **other stores**.
- **PAM rule**: Only stores with **>3 registered employees** can auto-display PAM options. Stores with ≤3 do not show automatic PAM (no fair cadastre without emptying original store).
- **Override**: Admin/Supervisor can force PAM for ≤3-employee stores. This override **must be recorded** in audit log (who, which store, optional reason).
- **Gaji/jam PAM**: Recorded in the **employee's original store**, not the helper store. Important for per-store performance reports.

## Agenda & Bonus (Agenda & Bonus)

- Two sources: **template_pusat** (central templates made by Manajer/Supervisor/Admin) and **mandiri_karyawan** (self-reported by employee).
- Both processed through **same verification & bonus alur**, but differentiated by `sumber` field for reporting.
- **Verification SLA**: end of the same day / end of Admin's shift. Pending items near SLA trigger OneSignal push reminder to the responsible Admin/Supervisor.
- If rejected: employee can resubmit (new record, old preserved in history).
- Each agenda has adjustable **nominal bonus** set by Manajer.

## Payroll & Gaji (Gaji & Payroll)

- **Gaji pokok** set by pusat (Manajer), not per store. Can differ per individual employee.
- **Calculation type** per employee: `HARIAN` (rate × actual days) or `BULANAN` (fixed base, adjusted with potongan/tambahan).
- Field `tipe_perhitungan_gaji` (enum `HARIAN`/`BULANAN`) is **required** on employee data.
- **Bonuses**: Every completed & verified agenda adds its nominal to gaji. Manual bonuses/potongan by Manajer are recommended by system but final decision rests with Manajer before payroll is locked.
- **Sales performance bonus**: **Not calculated automatically** from sales data (confirmed by project owner). Provide a free-form nominal field + keterangan opsional in monthly payroll form, filled by Manajer based on personal assessment.
- **Payroll lock**: Once locked by Manajer, data may not be changed directly. Create a "revisi" mechanism with audit trail instead.
- **Estimasi gaji dashboard**: Real-time from absensi, verified agenda, and recorded potongan. Label clearly as "estimasi" — final amount may change with manual bonus/potongan.

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
- If verifying attendance penalty: test the formula with exactly 5 min late (should be Rp0), 6 min late (Rp1000), 11 min late (Rp6000).
- If checking PAM auto-enable: test with exactly 3 employees (should NOT auto-show PAM) vs 4 employees (should auto-show).

## Prisma — Migration & Format

- **Jangan pakai `prisma migrate dev`** — hanya gunakan `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` untuk preview SQL migration.
- **Buat folder migration secara manual** dengan timestamp: `mkdir -p prisma/migrations/<YYYYMMDDHHMMSS>_<nama_migration>` lalu buat file `migration.sql` di dalamnya (satu statement per baris, diakhiri titik koma).
- **Apply migration dengan `npx prisma migrate deploy`** (bukan `prisma migrate dev`).
- **`tanggalShift` di `Attendance` disimpan sebagai `@db.Date` (date-only), dihitung dari `shiftMulai` dalam zona WIB (Asia/Jakarta)** menggunakan helper `computeTanggalShiftWIB`. Jangan pernah menulis `tanggalShift: shiftMulai` langsung.
- **Jangan jalankan `prisma format` di sesi normal** — ia mereformat seluruh file dan mengotori `git blame`. Kalau perlu format, lakukan di commit chore terpisah tanpa perubahan substantif.
