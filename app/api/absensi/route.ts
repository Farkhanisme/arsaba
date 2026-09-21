import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { computeTanggalShiftWIB } from "@/lib/absensi";
import { NextRequest, NextResponse } from "next/server";

const AUTO_CLOSE_MS = 20 * 60 * 60 * 1000;

// POST /api/absensi — CHECK-IN.
// absenMasuk ditentukan server. Auto-close lazy untuk shift menggantung >20 jam.
// menitTelat/potongan diisi 0 saat check-in; Admin mengisi saat verifikasi (V4e-1).
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!session.user.storeId) {
      return NextResponse.json(
        {
          error:
            "Akun ini tidak terhubung ke toko manapun, tidak bisa mengajukan absensi",
        },
        { status: 400 }
      );
    }

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

    const latitude = latitudeStr ? Number(latitudeStr) : undefined;
    const longitude = longitudeStr ? Number(longitudeStr) : undefined;
    if (
      latitude !== undefined &&
      (Number.isNaN(latitude) || latitude < -90 || latitude > 90)
    ) {
      return NextResponse.json(
        { error: "Latitude tidak valid" },
        { status: 400 }
      );
    }
    if (
      longitude !== undefined &&
      (Number.isNaN(longitude) || longitude < -180 || longitude > 180)
    ) {
      return NextResponse.json(
        { error: "Longitude tidak valid" },
        { status: 400 }
      );
    }

    const now = new Date();

    // Auto-close lazy: tutup shift menggantung > 20 jam
    const batasAutoClose = new Date(now.getTime() - AUTO_CLOSE_MS);
    await prisma.attendance.updateMany({
      where: {
        employeeId: session.user.id,
        absenKeluar: null,
        autoClosed: false,
        absenMasuk: { lt: batasAutoClose },
      },
      data: {
        autoClosed: true,
        autoClosedAt: now,
        statusKeluar: "PENDING_VERIFIKASI",
      },
    });

    // Cegah check-in dobel
    const existing = await prisma.attendance.findFirst({
      where: {
        employeeId: session.user.id,
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

    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `absensi-masuk-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, {
      asDocument: false,
    });

    const tanggalShift = computeTanggalShiftWIB(now);

    const attendance = await prisma.attendance.create({
      data: {
        employeeId: session.user.id,
        storeId: session.user.storeId,
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
