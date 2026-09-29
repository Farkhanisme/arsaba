import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import {
  AUTO_CLOSE_MS,
  computeTanggalShiftWIB,
  findShiftAcuan,
  formatTanggalWIB,
  hitungAbsenKeluarAutoClose,
  hitungTotalMenitKerja,
} from "@/lib/absensi";
import { NextRequest, NextResponse } from "next/server";
import type { Attendance, AttendanceLog } from "@prisma/client";

// Supervisor/Admin juga boleh absen (bisa tanpa toko). Manajer & Direktur tidak.
const ALLOWED_CHECKIN_ROLES = ["KARYAWAN", "KEPALA_TOKO", "SUPERVISOR", "ADMIN"];

// POST /api/absensi — CHECK-IN.
// absenMasuk & tanggalShift ditentukan server. tanggalShift diambil dari
// jamMulai ShiftAssignment APPROVED yang mencakup waktu check-in, sehingga
// check-in jam 02.00 Senin untuk shift Minggu 18.00–06.00 tetap terhitung
// hari Minggu. Tanpa shift → fallback tanggal kalender WIB, dan hanya boleh
// bila User.bolehAbsenTanpaShift = true.
// Auto-close lazy: shift menggantung >20 jam ditutup dengan absenKeluar =
// jamSelesai shift (fallback absenMasuk) supaya karyawan bisa check-in lagi.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!ALLOWED_CHECKIN_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak melakukan absensi." },
        { status: 403 }
      );
    }

    const employeeId = session.user.id;
    const storeId = session.user.storeId ?? null;

    const formData = await request.formData();
    const foto = formData.get("foto") as File | null;
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;

    if (!foto) {
      return NextResponse.json(
        { error: "Field 'foto' wajib diisi" },
        { status: 400 }
      );
    }

    const latitude: number | null = latitudeStr ? Number(latitudeStr) : null;
    const longitude: number | null = longitudeStr ? Number(longitudeStr) : null;
    if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      return NextResponse.json(
        { error: "Latitude tidak valid" },
        { status: 400 }
      );
    }
    if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      return NextResponse.json(
        { error: "Longitude tidak valid" },
        { status: 400 }
      );
    }

    const now = new Date();

    // --- Auto-close lazy: tutup shift menggantung > 20 jam --------------
    const batasAutoClose = new Date(now.getTime() - AUTO_CLOSE_MS);
    const menggantung = await prisma.attendance.findMany({
      where: {
        employeeId,
        absenKeluar: null,
        autoClosed: false,
        absenMasuk: { lt: batasAutoClose },
      },
      select: { id: true, absenMasuk: true },
    });

    for (const shift of menggantung) {
      // Shift acuan dicari relatif terhadap absenMasuk record itu, bukan `now`.
      const acuan = await findShiftAcuan(employeeId, shift.absenMasuk);
      const absenKeluar = hitungAbsenKeluarAutoClose(shift.absenMasuk, acuan);

      await prisma.$transaction(async (tx) => {
        await tx.attendance.update({
          where: { id: shift.id },
          data: {
            absenKeluar,
            totalMenitKerja: hitungTotalMenitKerja(shift.absenMasuk, absenKeluar),
            // Langsung DIVERIFIKASI: auto-close dianggap sudah selesai, tidak
            // perlu ditindak admin.
            statusKeluar: "DIVERIFIKASI",
            autoClosed: true,
            autoClosedAt: now,
            logs: {
              create: {
                jenis: "KELUAR",
                fotoFileId: null,
                absenServerPada: absenKeluar,
                status: "DIVERIFIKASI",
                verifiedById: null,
                verifiedAt: now,
                keteranganKoreksi: `Auto-close: tidak ada check-out dalam ${AUTO_CLOSE_MS / 3600000} jam`,
              },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            tabel: "Attendance",
            recordId: shift.id,
            aksi: "UPDATE",
            nilaiSesudah: {
              autoClosed: true,
              autoClosedAt: now.toISOString(),
              absenMasuk: shift.absenMasuk.toISOString(),
              absenKeluar: absenKeluar.toISOString(),
              statusKeluar: "DIVERIFIKASI",
            },
            actorId: employeeId,
            alasan: "Auto-close shift menggantung (> 20 jam) saat check-in berikutnya",
          },
        });
      });
    }

    // --- Cegah check-in dobel --------------------------------------------
    const existing = await prisma.attendance.findFirst({
      where: {
        employeeId,
        absenKeluar: null,
        autoClosed: false,
      },
    });
    if (existing) {
      return NextResponse.json(
        {
          error:
            "Anda masih dalam shift yang belum check-out. Lakukan check-out terlebih dahulu.",
        },
        { status: 409 }
      );
    }

    // --- Shift acuan & tanggalShift -------------------------------------
    const shiftAcuan = await findShiftAcuan(employeeId, now);

    if (!shiftAcuan && !session.user.bolehAbsenTanpaShift) {
      return NextResponse.json(
        {
          error:
            "Anda belum punya jadwal shift hari ini, jadi tidak bisa absen. Hubungi admin.",
        },
        { status: 403 }
      );
    }

    const tanggalShift = shiftAcuan?.tanggal ?? computeTanggalShiftWIB(now);

    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `absensi-masuk-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, {
      asDocument: false,
    });

    const attendance = await prisma.$transaction(async (tx) => {
      const created = await tx.attendance.create({
        data: {
          employeeId,
          storeId,
          tanggalShift,
          absenMasuk: now,
          fotoMasukDiambilPada: now,
          menitTelat: 0,
          potongan: 0,
          logs: {
            create: {
              jenis: "MASUK",
              fotoFileId: uploadResult.fileId,
              latitude,
              longitude,
              absenServerPada: now,
            },
          },
        },
        include: { logs: true },
      });

      await tx.auditLog.create({
        data: {
          tabel: "Attendance",
          recordId: created.id,
          aksi: "CREATE",
          nilaiSesudah: {
            id: created.id,
            employeeId: created.employeeId,
            storeId: created.storeId,
            tanggalShift: formatTanggalWIB(created.tanggalShift),
            absenMasuk: created.absenMasuk.toISOString(),
            menitTelat: created.menitTelat,
            potongan: created.potongan,
            statusMasuk: created.statusMasuk,
            statusKeluar: created.statusKeluar,
            isPam: created.isPam,
            autoClosed: created.autoClosed,
            shiftAcuan: shiftAcuan
              ? {
                  assignmentId: shiftAcuan.assignmentId,
                  segmen: shiftAcuan.segmen,
                  jamMulai: shiftAcuan.jamMulai.toISOString(),
                  jamSelesai: shiftAcuan.jamSelesai.toISOString(),
                }
              : null,
          },
          actorId: employeeId,
        },
      });

      return created;
    }) as Attendance & { logs: AttendanceLog[] };

    return NextResponse.json({
      id: attendance.id,
      employeeId: attendance.employeeId,
      storeId: attendance.storeId,
      tanggalShift: attendance.tanggalShift.toISOString(),
      absenMasuk: attendance.absenMasuk.toISOString(),
      absenKeluar: attendance.absenKeluar
        ? attendance.absenKeluar.toISOString()
        : null,
      menitTelat: attendance.menitTelat,
      potongan: attendance.potongan,
      statusMasuk: attendance.statusMasuk,
      statusKeluar: attendance.statusKeluar,
      fotoMasukDiambilPada: attendance.fotoMasukDiambilPada.toISOString(),
      autoClosed: attendance.autoClosed,
      shiftAcuan: shiftAcuan
        ? {
            segmen: shiftAcuan.segmen,
            jamMulai: shiftAcuan.jamMulai.toISOString(),
            jamSelesai: shiftAcuan.jamSelesai.toISOString(),
          }
        : null,
      logs: attendance.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        fotoFileId: l.fotoFileId,
        latitude: l.latitude,
        longitude: l.longitude,
        absenServerPada: l.absenServerPada.toISOString(),
        status: l.status,
      })),
      createdAt: attendance.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /api/absensi error:", err);
    if (err instanceof Error && err.message.includes("Telegram")) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal memproses absensi. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
