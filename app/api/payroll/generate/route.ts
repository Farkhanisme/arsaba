import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hitungBaseGaji, jamTerbayarDariMenit, menitEfektif } from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["MANAJER"];

interface GenerateBody {
  periode: string; // "YYYY-MM"
}

interface PayrollItemResult {
  employeeId: string;
  employeeKode: string;
  employeeNama: string;
  gajiPokok: number;
  totalHariKerja: number | null;
  totalBonusAgenda: number;
  totalPotonganTelat: number;
  bonusManual: number;
  potonganManual: number;
  bonusPerforma: number;
  keteranganBonusPerforma: string | null;
  totalGaji: number;
  status: string;
  /** "created" = baru; "updated" = re-sync DRAFT; "skipped" = sudah LOCKED. */
  action: "created" | "updated" | "skipped";
  /** true kalau payroll LOCKED tapi angka terkini berbeda -> perlu direvisi. */
  perluRevisi: boolean;
  selisihBonus: number;
  selisihPotongan: number;
  selisihTotal: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya MANAJER yang boleh generate payroll." },
        { status: 403 }
      );
    }

    let body: GenerateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const { periode } = body;
    if (!periode || typeof periode !== "string") {
      return NextResponse.json({ error: "Field 'periode' (YYYY-MM) wajib diisi." }, { status: 400 });
    }

    // Validasi format YYYY-MM
    const periodeRegex = /^\d{4}-\d{2}$/;
    if (!periodeRegex.test(periode)) {
      return NextResponse.json({ error: "Format periode harus YYYY-MM (contoh: 2026-09)." }, { status: 400 });
    }

    const [yearStr, monthStr] = periode.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "Bulan tidak valid (1-12)." }, { status: 400 });
    }

    // Buat tanggal 1 bulan tersebut di UTC (midnight)
    const periodeDate = new Date(Date.UTC(year, month - 1, 1));

    // Validasi: tidak boleh masa depan > 1 bulan dari bulan ini
    // Masa lalu (backfill) diperbolehkan tanpa batas
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const maxAllowedMonth = currentMonth + 1;
    const maxAllowedYear = maxAllowedMonth > 12 ? currentYear + 1 : currentYear;
    const maxAllowedMonthAdjusted = maxAllowedMonth > 12 ? 1 : maxAllowedMonth;

    if (year > maxAllowedYear || (year === maxAllowedYear && month > maxAllowedMonthAdjusted)) {
      return NextResponse.json(
        { error: "Periode tidak boleh lebih dari 1 bulan ke depan dari bulan berjalan." },
        { status: 400 }
      );
    }

    // Hitung batas awal & akhir bulan untuk query (UTC)
    const awalBulan = new Date(Date.UTC(year, month - 1, 1));
    const akhirBulan = new Date(Date.UTC(year, month, 1)); // 1 bulan berikutnya

    // Ambil semua karyawan AKTIF dengan tipePerhitunganGaji sudah di-set
    const karyawanList = await prisma.user.findMany({
      where: {
        status: "AKTIF",
        tipePerhitunganGaji: { not: null },
      },
      select: {
        id: true,
        kode: true,
        nama: true,
        tipePerhitunganGaji: true,
        tarifPerJam: true,
        tarifPerHari: true,
        gajiPokok: { select: { nominal: true } },
      },
    });

    if (karyawanList.length === 0) {
      return NextResponse.json({
        periode,
        totalKaryawan: 0,
        totalGenerated: 0,
        totalSkipped: 0,
        items: [],
      });
    }

    // Pre-fetch data untuk perhitungan batch
    const employeeIds = karyawanList.map((k) => k.id);

    // 1. Attendance agregat per karyawan.
    //
    //    Sengaja TIDAK pakai `groupBy` untuk bagian jam, karena `groupBy`
    //    menjumlahkan baris dan menghilangkan identitas record. Untuk kasus PAM
    //    (2 segmen pada tanggal yang sama) itu merusak koreksi manual:
    //
    //      segmen A dikoreksi 300 -> 480, segmen B tetap 300
    //      groupBy  : SUM(totalMenitManual) = 480  -> floor(480/60)  =  8 jam  ❌
    //      per-record: 480 + 300 = 780            -> floor(780/60)  = 13 jam  ✅
    //
    //    `_sum` juga tidak bisa_fee nullable-per-record: `SUM` kolom yang null
    //    mengabaikan baris itu, sehingga "hanya A yang dikoreksi" tidak bisa
    //    dibedakan dari "semua segmen dikoreksi". Karena itu diambil per record
    //    lalu digabung di JS.
    //
    //    Perilaku yang dihasilkan:
    //      totalHariKerja   = jumlah tanggalShift UNIK
    //      totalJamTerbayar = SUM floor(menitEfektif per record)  -> floor per
    //                         SEGMENT, bukan per tanggal. Untuk kasus umum
    //                         (1 segmen per hari) identik dengan "per hari".
    //      totalPotonganTelat = SUM potongan
    const attendanceRows = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        tanggalShift: { gte: awalBulan, lt: akhirBulan },
        statusMasuk: "DIVERIFIKASI",
      },
      select: {
        employeeId: true,
        tanggalShift: true,
        totalMenitKerja: true,
        totalMenitManual: true,
        potongan: true,
      },
    });

    // Map attendance data
    const attendanceMap = new Map<
      string,
      {
        hariUnik: Set<string>;
        totalMenitKerja: number;
        totalJamTerbayar: number;
        totalPotonganTelat: number;
      }
    >();
    for (const a of attendanceRows) {
      let cur = attendanceMap.get(a.employeeId);
      if (!cur) {
        cur = {
          hariUnik: new Set<string>(),
          totalMenitKerja: 0,
          totalJamTerbayar: 0,
          totalPotonganTelat: 0,
        };
        attendanceMap.set(a.employeeId, cur);
      }
      // Set = tanggal unik, jadi 2 segmen di hari yang sama tetap 1 hari.
      cur.hariUnik.add(a.tanggalShift.toISOString().slice(0, 10));
      cur.totalMenitKerja += a.totalMenitKerja;
      // Floor per record (segmen). Untuk 1 segmen/hari sama dengan per hari.
      cur.totalJamTerbayar += jamTerbayarDariMenit(
        menitEfektif({
          totalMenitKerja: a.totalMenitKerja,
          totalMenitManual: a.totalMenitManual,
        })
      );
      cur.totalPotonganTelat += a.potongan;
    }

    // 2. Agenda: totalBonusAgenda (SUM nominal where status = DIVERIFIKASI, targetEmployeeId, diselesaikanPada di bulan)
    const agendaAgg = await prisma.agenda.groupBy({
      by: ["targetEmployeeId"],
      where: {
        targetEmployeeId: { in: employeeIds },
        status: "DIVERIFIKASI",
        diselesaikanPada: { gte: awalBulan, lt: akhirBulan },
        nominal: { not: null },
      },
      _sum: { nominal: true },
    });

    const agendaMap = new Map<string, number>();
    for (const a of agendaAgg) {
      if (a.targetEmployeeId) {
        agendaMap.set(a.targetEmployeeId, a._sum.nominal ?? 0);
      }
    }

    // Proses dalam transaction
    const results: PayrollItemResult[] = [];

    await prisma.$transaction(async (tx) => {
      const createdPayrolls: Array<{
        id: string;
        employeeId: string;
        periode: Date;
        gajiPokok: number;
        totalHariKerja: number | null;
        totalBonusAgenda: number;
        totalPotonganTelat: number;
        bonusManual: number;
        potonganManual: number;
        bonusPerforma: number;
        keteranganBonusPerforma: string | null;
        totalGaji: number;
        status: string;
      }> = [];

      for (const karyawan of karyawanList) {
        // Payroll yang sudah ada untuk periode ini.
        //
        // Tiga kemungkinan:
        //   - belum ada          -> buat baru ("created")
        //   - sudah ada & DRAFT  -> hitung ULANG angka otomatis ("updated")
        //   - sudah ada & LOCKED -> jangan sentuh ("skipped"), tapi laporkan
        //                          berapa angka yang tertinggal supaya Manajer
        //                          tahu harus merevisi (§7.1b).
        //
        // Kenapa DRAFT boleh di-update: Dulu route ini selalu skip, sehingga
        // agenda yang diverifikasi SETELAH generate tidak pernah masuk gaji —
        // bonus hilang senyap tanpa warning. Perhitungan ulang TIDAK BOLEH
        // menimpa field input manual (bonusManual, potonganManual, bonusPerforma).
        const existing = await tx.payroll.findUnique({
          where: {
            employeeId_periode: {
              employeeId: karyawan.id,
              periode: periodeDate,
            },
          },
        });

        const att = attendanceMap.get(karyawan.id) ?? {
          hariUnik: new Set<string>(),
          totalMenitKerja: 0,
          totalJamTerbayar: 0,
          totalPotonganTelat: 0,
        };
        const totalBonusAgenda = agendaMap.get(karyawan.id) ?? 0;
        const gajiPokokNominal = karyawan.gajiPokok?.nominal ?? 0;

        // baseGaji dihitung oleh helper bersama (lib/gaji.ts) supaya rumus
        // payroll ini identik dengan estimasi di /api/dashboard/gaji.
        //
        // PENTING §7.1a: untuk tipe JAM, `floor` diterapkan PER HARI lalu
        // dijumlah — bukan atas total menit sebulan. Pembulatan per hari
        // dilakukan saat agregasi (lihat attendanceMap di atas).
        const tipe = karyawan.tipePerhitunganGaji!;
        const baseGaji = hitungBaseGaji({
          tipe,
          tarifPerJam: karyawan.tarifPerJam,
          tarifPerHari: karyawan.tarifPerHari,
          gajiPokokNominal,
          totalHariKerja: att.hariUnik.size,
          totalJamTerbayar: att.totalJamTerbayar,
        });

        // Komponen input manual: 0 untuk payroll BARU. Untuk payroll yang sudah
        // ada, NILAI LAMA yang dipakai lagi — bukan 0. Kalau di sini tetap 0,
        // `totalGaji` hasil re-sync akan tidak sama dengan penjumlahan field yang
        // tampil di payslip (bonusManual + bonusPerforma diabaikan), sehingga
        // payslip jadi tidak konsisten dengan komponennya sendiri.
        const bonusManual = existing?.bonusManual ?? 0;
        const potonganManual = existing?.potonganManual ?? 0;
        const bonusPerforma = existing?.bonusPerforma ?? 0;
        const keteranganBonusPerforma = existing?.keteranganBonusPerforma ?? null;

        const totalGaji =
          baseGaji +
          totalBonusAgenda +
          bonusManual +
          bonusPerforma -
          att.totalPotonganTelat -
          potonganManual;

        const totalHariKerjaFinal = tipe === "HARIAN" ? att.hariUnik.size : null;

        if (existing) {
          if (existing.status === "LOCKED") {
            // Payslip sudah final. Laporkan selisihnya — jangan diubah diam-diam.
            const selisihBonus = totalBonusAgenda - existing.totalBonusAgenda;
            const selisihPotongan =
              att.totalPotonganTelat - existing.totalPotonganTelat;
            const selisihTotal = totalGaji - existing.totalGaji;

            results.push({
              employeeId: karyawan.id,
              employeeKode: karyawan.kode,
              employeeNama: karyawan.nama,
              gajiPokok: existing.gajiPokok,
              totalHariKerja: existing.totalHariKerja,
              totalBonusAgenda: existing.totalBonusAgenda,
              totalPotonganTelat: existing.totalPotonganTelat,
              bonusManual: existing.bonusManual,
              potonganManual: existing.potonganManual,
              bonusPerforma: existing.bonusPerforma,
              keteranganBonusPerforma: existing.keteranganBonusPerforma,
              totalGaji: existing.totalGaji,
              status: existing.status,
              action: "skipped",
              perluRevisi: selisihTotal !== 0,
              selisihBonus,
              selisihPotongan,
              selisihTotal,
            });
            continue;
          }

          // DRAFT — hitung ulang angka otomatis, JAGA field input manual.
          const updated = await tx.payroll.update({
            where: { id: existing.id },
            data: {
              gajiPokok: gajiPokokNominal,
              totalHariKerja: totalHariKerjaFinal,
              totalBonusAgenda,
              totalPotonganTelat: att.totalPotonganTelat,
              totalGaji,
            },
          });

          await tx.auditLog.create({
            data: {
              tabel: "Payroll",
              recordId: updated.id,
              aksi: "UPDATE",
              nilaiSebelum: {
                totalHariKerja: existing.totalHariKerja,
                totalBonusAgenda: existing.totalBonusAgenda,
                totalPotonganTelat: existing.totalPotonganTelat,
                totalGaji: existing.totalGaji,
              },
              nilaiSesudah: {
                totalHariKerja: updated.totalHariKerja,
                totalBonusAgenda: updated.totalBonusAgenda,
                totalPotonganTelat: updated.totalPotonganTelat,
                totalGaji: updated.totalGaji,
              },
              actorId: session.user.id,
              alasan: "Re-sync payroll DRAFT (generate ulang)",
            },
          });

          results.push({
            employeeId: karyawan.id,
            employeeKode: karyawan.kode,
            employeeNama: karyawan.nama,
            gajiPokok: updated.gajiPokok,
            totalHariKerja: updated.totalHariKerja,
            totalBonusAgenda: updated.totalBonusAgenda,
            totalPotonganTelat: updated.totalPotonganTelat,
            bonusManual: updated.bonusManual,
            potonganManual: updated.potonganManual,
            bonusPerforma: updated.bonusPerforma,
            keteranganBonusPerforma: updated.keteranganBonusPerforma,
            totalGaji: updated.totalGaji,
            status: updated.status,
            action: "updated",
            perluRevisi: false,
            selisihBonus: 0,
            selisihPotongan: 0,
            selisihTotal: 0,
          });
          continue;
        }

        // Create payroll
        const payroll = await tx.payroll.create({
          data: {
            employeeId: karyawan.id,
            periode: periodeDate,
            gajiPokok: gajiPokokNominal,
            totalHariKerja: tipe === "HARIAN" ? att.hariUnik.size : null,
            totalBonusAgenda,
            totalPotonganTelat: att.totalPotonganTelat,
            bonusManual,
            potonganManual,
            bonusPerforma,
            keteranganBonusPerforma,
            totalGaji,
            status: "DRAFT",
          },
        });

        results.push({
          employeeId: karyawan.id,
          employeeKode: karyawan.kode,
          employeeNama: karyawan.nama,
          gajiPokok: payroll.gajiPokok,
          totalHariKerja: payroll.totalHariKerja,
          totalBonusAgenda: payroll.totalBonusAgenda,
          totalPotonganTelat: payroll.totalPotonganTelat,
          bonusManual: payroll.bonusManual,
          potonganManual: payroll.potonganManual,
          bonusPerforma: payroll.bonusPerforma,
          keteranganBonusPerforma: payroll.keteranganBonusPerforma,
          totalGaji: payroll.totalGaji,
          status: payroll.status,
          action: "created",
          perluRevisi: false,
          selisihBonus: 0,
          selisihPotongan: 0,
          selisihTotal: 0,
        });

        // Collect for audit log
        createdPayrolls.push(payroll);
      }

    // Batch create audit logs inline
    if (createdPayrolls.length > 0) {
      await tx.auditLog.createMany({
        data: createdPayrolls.map((p) => ({
          tabel: "Payroll",
          recordId: p.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: p.id,
            employeeId: p.employeeId,
            periode: p.periode.toISOString(),
            gajiPokok: p.gajiPokok,
            totalHariKerja: p.totalHariKerja,
            totalBonusAgenda: p.totalBonusAgenda,
            totalPotonganTelat: p.totalPotonganTelat,
            bonusManual: p.bonusManual,
            potonganManual: p.potonganManual,
            bonusPerforma: p.bonusPerforma,
            keteranganBonusPerforma: p.keteranganBonusPerforma,
            totalGaji: p.totalGaji,
            status: p.status,
          },
          actorId: session.user.id,
        })),
      });
    }
  });

    const totalGenerated = results.filter((r) => r.action === "created").length;
    const totalUpdated = results.filter((r) => r.action === "updated").length;
    const totalSkipped = results.filter((r) => r.action === "skipped").length;
    // Payroll yang LOCKED tapi angkanya sudah tidak sama dengan data terkini.
    // Ini yang harus direvisi lewat POST /api/payroll/[id]/revise.
    const perluRevisi = results.filter((r) => r.perluRevisi);

    // Absensi yang masih PENDING_VERIFIKASI = hari kerja yang TIDAK masuk
    // angka di atas. Disampaikan di sini supaya ketahuan sebelum Manajer
    // mencoba lock, bukan baru ditolak saat itu juga.
    //
    // Query terpisah (bukan join ke dalam transaksi) supaya tidak menambah
    // query per karyawan, dan supaya tidak mengunci baris payroll lebih lama
    // dari yang perlu.
    const tertunda = await prisma.attendance.findMany({
      where: {
        employeeId: { in: karyawanList.map((k) => k.id) },
        tanggalShift: { gte: awalBulan, lt: akhirBulan },
        statusMasuk: "PENDING_VERIFIKASI",
      },
      select: { employeeId: true, tanggalShift: true },
      orderBy: { tanggalShift: "asc" },
    });
    const belumTerverifikasi = [...new Set(tertunda.map((t) => t.employeeId))].map(
      (employeeId) => {
        const milik = tertunda.filter((t) => t.employeeId === employeeId);
        const karyawan = karyawanList.find((k) => k.id === employeeId);
        return {
          employeeId,
          employeeNama: karyawan?.nama ?? null,
          jumlah: milik.length,
          tanggal: milik.map((m) => m.tanggalShift.toISOString().slice(0, 10)),
        };
      }
    );

    return NextResponse.json({
      periode,
      totalKaryawan: karyawanList.length,
      totalGenerated,
      totalUpdated,
      totalSkipped,
      totalPerluRevisi: perluRevisi.length,
      perluRevisi,
      totalBelumTerverifikasi: belumTerverifikasi.length,
      belumTerverifikasi,
      items: results,
    });
  } catch (err) {
    console.error("POST /api/payroll/generate error:", err);
    return NextResponse.json({ error: "Gagal generate payroll." }, { status: 500 });
  }
}