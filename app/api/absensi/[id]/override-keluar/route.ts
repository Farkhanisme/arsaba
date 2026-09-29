import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hitungTotalMenitKerja } from "@/lib/absensi";
import { payrollLocked, pesanPayrollLocked } from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];

/**
 * Batas atas selisih absen masuk -> absen keluar.
 *
 * Dipakai `>`, bukan `>=`, jadi tepat 24 jam masih boleh. Itu disengaja:
 * ada toko yang buka 24 jam (Arsaba Mart, lihat AGENTS.md), dan karyawan yang
 * masuk 08:00 lalu keluar 08:00 keesokan hari itu kasus yang sah.
 *
 * Yang tidak boleh terjadi: masuk hari ini, keluar 3 minggu kemudian karena
 * salah ketik tahun. Tanpa batas ini, `totalMenitKerja` bisa bernilai ratusan
 * ribu menit dan langsung masuk perhitungan gaji.
 */
const MAKS_SELISIH_MENIT = 24 * 60;

/** Toleransi untuk keterlambatan jam server vs jam perangkat. */
const TOLERANSI_MASA_DEPAN_MENIT = 5;

type Body = {
  absenKeluar?: unknown;
  keterangan?: unknown;
};

// PATCH /api/absensi/[id]/override-keluar
// Body: { absenKeluar: ISO string, keterangan: string }
// Dipakai untuk: karyawan lupa check-out, atau admin menyelesaikan shift yang
// absen keluarnya bermasalah dan tidak bisa diselesaikan karyawan.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengoreksi absen keluar." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    if (typeof body.absenKeluar !== "string") {
      return NextResponse.json(
        { error: "Field 'absenKeluar' wajib diisi (ISO datetime)." },
        { status: 400 }
      );
    }
    const absenKeluar = new Date(body.absenKeluar);
    if (Number.isNaN(absenKeluar.getTime())) {
      return NextResponse.json(
        { error: "Format 'absenKeluar' tidak valid (harus ISO datetime)." },
        { status: 400 }
      );
    }

    if (typeof body.keterangan !== "string" || body.keterangan.trim().length < 3) {
      return NextResponse.json(
        { error: "Field 'keterangan' wajib diisi, minimal 3 karakter." },
        { status: 400 }
      );
    }
    const keterangan = body.keterangan.trim();

    // ------------------------------------------------------------------
    // Validasi batas waktu (P0-3).
    //
    // Dulu route ini hanya memeriksa "formatnya bisa di-parse". Akibatnya
    // `absenKeluar` tahun 2099 diterima, dan `hitungTotalMenitKerja` menulis
    // `totalMenitKerja` ratusan ribu menit — yang langsung masuk hitungan gaji
    // untuk tipe `JAM`.
    //
    // Perhatikan: `hitungTotalMenitKerja` memakai `Math.max(0, …)`, jadi waktu
    // keluar yang lebih awal dari masuk TIDAK menghasilkan error — hanya
    // 0 menit yang diam-diam. Itu lebih buruk daripada error, karena terlihat
    // "berhasil" padahal angkanya salah. Karena itu dicek eksplisit di sini.
    //
    // CATATAN DESAIN: validasi ini hanya untuk koreksi WAKTU check-out. Kalau
    // memang perlu menambah jam kerja (mis. lembur yang lupa dicek-out), itu
    // lewat `POST /api/absensi/[id]/koreksi-jam` — dengan alasan dan audit
    // sendiri. Sengaja tidak digabung di sini supaya `totalMenitManual`
    // selalu berarti "keputusan Manajer", bukan hasil hitungan absensi.
    //
    // Catatan: batas di bawah butuh `attendance.absenMasuk`, jadi dijalankan
    // SETELAH record absensi diambil (lihat blok di bawah).
    // ------------------------------------------------------------------
    if (absenKeluar.getTime() > Date.now() + TOLERANSI_MASA_DEPAN_MENIT * 60_000) {
      return NextResponse.json(
        { error: "Waktu keluar tidak boleh di masa depan." },
        { status: 400 }
      );
    }

    const attendance = await prisma.attendance.findUnique({ where: { id } });
    if (!attendance) {
      return NextResponse.json({ error: "Absensi tidak ditemukan." }, { status: 404 });
    }

    if (attendance.employeeId === session.user.id) {
      return NextResponse.json(
        { error: "Tidak boleh mengoreksi absensi sendiri." },
        { status: 403 }
      );
    }

    if (attendance.absenKeluar !== null) {
      return NextResponse.json(
        { error: "Absen keluar sudah ada, tidak bisa di-override." },
        { status: 409 }
      );
    }

    // Waktu keluar tidak boleh lebih awal dari masuk.
    //
    // TANPA cek ini, `hitungTotalMenitKerja` mengembalikan 0 menit secara diam
    // diam (karena `Math.max(0, …)`), route membalas 200, dan payslip menunjukkan
    // "0 menit" seolah-olah itu hasil yang benar.
    if (absenKeluar.getTime() < attendance.absenMasuk.getTime()) {
      return NextResponse.json(
        {
          error:
            "Waktu keluar tidak boleh lebih awal dari waktu masuk " +
            `(${attendance.absenMasuk.toISOString()}).`,
        },
        { status: 400 }
      );
    }

    const selisihMenit = Math.floor(
      (absenKeluar.getTime() - attendance.absenMasuk.getTime()) / 60_000
    );
    if (selisihMenit > MAKS_SELISIH_MENIT) {
      return NextResponse.json(
        {
          error:
            `Selisih masuk-keluar ${Math.floor(selisihMenit / 60)} jam melebihi batas ` +
            `${MAKS_SELISIH_MENIT / 60} jam. Kalau memang perlu menambah jam kerja, ` +
            `pakai fitur Koreksi Jam di halaman payslip — bukan override waktu keluar.`,
        },
        { status: 400 }
      );
    }

    // Payslip bulan yang memuat `tanggalShift` ini sudah final?
    //
    // Route ini menulis `totalMenitKerja` — angka yang dipakai `hitungBaseGaji`
    // untuk tipe `JAM`. Tanpa guard, override bisa menabrak payslip yang sudah
    // dikunci, dan karena `PATCH /api/payroll/[id]` menolak saat LOCKED, tidak
    // ada jalan memperbaikinya. Pola ini sama dengan `koreksi-jam`.
    if (await payrollLocked(prisma, attendance.employeeId, attendance.tanggalShift)) {
      return NextResponse.json(
        { error: pesanPayrollLocked(attendance.tanggalShift) },
        { status: 409 }
      );
    }

    const now = new Date();
    const totalMenitKerja = hitungTotalMenitKerja(attendance.absenMasuk, absenKeluar);

    // Transaksi + audit.
    //
    // Dulu `prisma.attendance.update` berdiri sendiri tanpa jejak. Padahal ini
    // outcome verifikasi (`statusKeluar` -> DIVERIFIKASI) DAN perubahan angka
    // gaji, dua hal yang `AGENTS.md` mewajibkan punya `AuditLog`.
    const nilaiSebelum = {
      absenKeluar: attendance.absenKeluar,
      totalMenitKerja: attendance.totalMenitKerja,
      statusKeluar: attendance.statusKeluar,
    };

    const updated = await prisma.$transaction(async (tx) => {
      // Baca ulang DI DALAM transaksi supaya `nilaiSebelum` benar-benar
      // mencerminkan baris yang diubah, bukan hasil baca yang bisa sudah basi.
      const fresh = await tx.attendance.findUnique({ where: { id } });
      if (!fresh || fresh.absenKeluar !== null) {
        throw new Error("ABSEN_KELUAR_SUDAH_ADA");
      }
      nilaiSebelum.absenKeluar = fresh.absenKeluar;
      nilaiSebelum.totalMenitKerja = fresh.totalMenitKerja;
      nilaiSebelum.statusKeluar = fresh.statusKeluar;

      const row = await tx.attendance.update({
        where: { id },
        data: {
          absenKeluar,
          fotoKeluarDiambilPada: now,
          statusKeluar: "DIVERIFIKASI",
          totalMenitKerja,
          logs: {
            create: {
              jenis: "KELUAR",
              absenServerPada: absenKeluar,
              status: "DIVERIFIKASI",
              verifiedById: session.user.id,
              verifiedAt: now,
              keteranganKoreksi: keterangan,
              isOverride: true,
            },
          },
        },
        include: { logs: { orderBy: { createdAt: "asc" } } },
      });

      await tx.auditLog.create({
        data: {
          tabel: "Attendance",
          recordId: id,
          aksi: "UPDATE",
          nilaiSebelum,
          nilaiSesudah: {
            absenKeluar: absenKeluar.toISOString(),
            totalMenitKerja: row.totalMenitKerja,
            statusKeluar: row.statusKeluar,
          },
          actorId: session.user.id,
          alasan: `Override absen keluar: ${keterangan}`,
        },
      });

      return row;
    }).catch((err) => {
      if (err instanceof Error && err.message === "ABSEN_KELUAR_SUDAH_ADA") return null;
      throw err;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Absen keluar sudah ada, tidak bisa di-override." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      id: updated.id,
      statusMasuk: updated.statusMasuk,
      statusKeluar: updated.statusKeluar,
      totalMenitKerja: updated.totalMenitKerja,
      absenMasuk: updated.absenMasuk.toISOString(),
      absenKeluar: updated.absenKeluar ? updated.absenKeluar.toISOString() : null,
      fotoKeluarDiambilPada: updated.fotoKeluarDiambilPada
        ? updated.fotoKeluarDiambilPada.toISOString()
        : null,
      logs: updated.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        status: l.status,
        absenServerPada: l.absenServerPada.toISOString(),
        isOverride: l.isOverride,
        keteranganKoreksi: l.keteranganKoreksi,
        verifiedById: l.verifiedById,
      })),
    });
  } catch (err) {
    console.error("PATCH /api/absensi/[id]/override-keluar error:", err);
    return NextResponse.json(
      { error: "Gagal memproses override. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
