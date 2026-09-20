import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

// POST /api/absensi/resubmit — ABSEN ULANG untuk absen MASUK yang DITOLAK.
// absenMasuk TIDAK berubah (timestamp asli). Hanya foto dan fotoMasukDiambilPada
// yang di-update. Log lama tetap tersimpan sebagai riwayat audit.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const formData = await request.formData();
    const foto = formData.get("foto") as File | null;
    const keterangan = formData.get("keterangan") as string | null;
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;

    if (!foto) {
      return NextResponse.json({ error: "Field 'foto' wajib diisi" }, { status: 400 });
    }
    if (typeof keterangan !== "string" || keterangan.trim().length < 3) {
      return NextResponse.json(
        { error: "Field 'keterangan' wajib diisi, minimal 3 karakter." },
        { status: 400 }
      );
    }

    const latitude = latitudeStr ? Number(latitudeStr) : undefined;
    const longitude = longitudeStr ? Number(longitudeStr) : undefined;
    if (latitude !== undefined && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      return NextResponse.json({ error: "Latitude tidak valid" }, { status: 400 });
    }
    if (longitude !== undefined && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      return NextResponse.json({ error: "Longitude tidak valid" }, { status: 400 });
    }

    // Cari shift aktif milik user
    const attendance = await prisma.attendance.findFirst({
      where: { employeeId: session.user.id, absenKeluar: null, autoClosed: false },
      orderBy: { absenMasuk: "desc" },
    });
    if (!attendance) {
      return NextResponse.json(
        { error: "Tidak ada shift aktif untuk di-resubmit." },
        { status: 409 }
      );
    }

    if (attendance.statusMasuk !== "DITOLAK") {
      return NextResponse.json(
        { error: "Absen masuk shift ini belum ditolak, tidak perlu resubmit." },
        { status: 409 }
      );
    }

    const now = new Date();
    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `absensi-resubmit-${Date.now()}.jpg`;
    const uploadResult = await uploadToTelegram(buffer, filename, { asDocument: false });

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        statusMasuk: "PENDING_VERIFIKASI",
        fotoMasukDiambilPada: now,
        // absenMasuk TIDAK diubah — timestamp asli tetap
        logs: {
          create: {
            jenis: "MASUK",
            fotoFileId: uploadResult.fileId,
            latitude,
            longitude,
            absenServerPada: now,
            keteranganKoreksi: keterangan.trim(),
          },
        },
      },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({
      id: updated.id,
      statusMasuk: updated.statusMasuk,
      statusKeluar: updated.statusKeluar,
      absenMasuk: updated.absenMasuk.toISOString(),
      fotoMasukDiambilPada: updated.fotoMasukDiambilPada.toISOString(),
      logs: updated.logs.map((l) => ({
        id: l.id,
        jenis: l.jenis,
        status: l.status,
        absenServerPada: l.absenServerPada.toISOString(),
        keteranganKoreksi: l.keteranganKoreksi,
        rejectedReason: l.rejectedReason,
      })),
    });
  } catch (err) {
    console.error("POST /api/absensi/resubmit error:", err);
    if (err instanceof Error && err.message.includes("Telegram")) {
      return NextResponse.json(
        { error: `Gagal upload ke Telegram: ${err.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Gagal memproses resubmit. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
