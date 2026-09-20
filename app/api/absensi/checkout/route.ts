import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

// POST /api/absensi/checkout — CHECK-OUT.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const formData = await request.formData();
    const foto = formData.get("foto") as File | null;
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;

    if (!foto) {
      return NextResponse.json({ error: "Field 'foto' wajib diisi" }, { status: 400 });
    }

    const latitude = latitudeStr ? Number(latitudeStr) : undefined;
    const longitude = longitudeStr ? Number(longitudeStr) : undefined;
    if (latitude !== undefined && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      return NextResponse.json({ error: "Latitude tidak valid" }, { status: 400 });
    }
    if (longitude !== undefined && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      return NextResponse.json({ error: "Longitude tidak valid" }, { status: 400 });
    }

    const existing = await prisma.attendance.findFirst({
      where: { employeeId: session.user.id, absenKeluar: null, autoClosed: false },
      orderBy: { absenMasuk: "desc" },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Tidak ada shift aktif. Lakukan check-in terlebih dahulu." },
        { status: 409 }
      );
    }

    const now = new Date();
    const totalMenitKerja = Math.max(
      0,
      Math.floor((now.getTime() - existing.absenMasuk.getTime()) / 60000)
    );

    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `absensi-keluar-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, { asDocument: false });

    const attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        absenKeluar: now,
        fotoKeluarDiambilPada: now,
        statusKeluar: "PENDING_VERIFIKASI",
        totalMenitKerja,
        logs: {
          create: {
            jenis: "KELUAR",
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
      absenMasuk: attendance.absenMasuk.toISOString(),
      absenKeluar: attendance.absenKeluar ? attendance.absenKeluar.toISOString() : null,
      statusMasuk: attendance.statusMasuk,
      statusKeluar: attendance.statusKeluar,
      totalMenitKerja: attendance.totalMenitKerja,
      fotoKeluarDiambilPada: attendance.fotoKeluarDiambilPada
        ? attendance.fotoKeluarDiambilPada.toISOString()
        : null,
      logs: attendance.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        fotoFileId: l.fotoFileId,
        absenServerPada: l.absenServerPada.toISOString(),
        status: l.status,
      })),
    });
  } catch (err) {
    console.error("POST /api/absensi/checkout error:", err);
    if (err instanceof Error && err.message.includes("Telegram")) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal memproses check-out. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
