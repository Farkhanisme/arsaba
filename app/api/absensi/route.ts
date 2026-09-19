import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadToTelegram } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Konversi shiftMulai (UTC instant) ke tanggal WIB, dikembalikan sebagai Date di UTC midnight.
// Ini yang membuat Prisma @db.Date menyimpan tanggal WIB dengan benar, termasuk untuk
// shift yang mulai setelah 17:00 UTC (= 00:00 WIB hari berikutnya).
function computeTanggalShiftWIB(shiftMulai: Date): Date {
  const wib = new Date(shiftMulai.getTime() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi session
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // Validasi storeId — karyawan harus terhubung ke toko
    if (!session.user.storeId) {
      return NextResponse.json({ error: "Akun ini tidak terhubung ke toko manapun, tidak bisa mengajukan absensi" }, { status: 400 });
    }

    // 2. Parse multipart/form-data
    const formData = await request.formData();
    
    const foto = formData.get("foto") as File | null;
    const shiftMulaiStr = formData.get("shiftMulai") as string | null;
    const shiftSelesaiStr = formData.get("shiftSelesai") as string | null;
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;

    // Validasi field wajib
    if (!foto) {
      return NextResponse.json({ error: "Field 'foto' wajib diisi" }, { status: 400 });
    }
    if (!shiftMulaiStr) {
      return NextResponse.json({ error: "Field 'shiftMulai' wajib diisi" }, { status: 400 });
    }
    if (!shiftSelesaiStr) {
      return NextResponse.json({ error: "Field 'shiftSelesai' wajib diisi" }, { status: 400 });
    }

    const shiftMulai = new Date(shiftMulaiStr);
    const shiftSelesai = new Date(shiftSelesaiStr);

    if (isNaN(shiftMulai.getTime()) || isNaN(shiftSelesai.getTime())) {
      return NextResponse.json({ error: "Format shiftMulai/shiftSelesai tidak valid (harus ISO datetime)" }, { status: 400 });
    }

    // Optional geolocation
    const latitude = latitudeStr ? parseFloat(latitudeStr) : undefined;
    const longitude = longitudeStr ? parseFloat(longitudeStr) : undefined;

    // 3. Konversi file ke Buffer dan upload ke Telegram (mode sendPhoto untuk absensi)
    const arrayBuffer = await foto.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = foto.name || `absensi-${Date.now()}.jpg`;

    const uploadResult = await uploadToTelegram(buffer, foto.name || `absensi-${Date.now()}.jpg`, {
      asDocument: false, // mode sendPhoto untuk absensi
    });

    // 4. Hitung keterlambatan di server (JANGAN percaya client)
    const absenWaktu = new Date();
    const diffMs = absenWaktu.getTime() - shiftMulai.getTime();
    const diffMinutes = Math.floor(diffMs / 60000); // selisih dalam menit (bulat ke bawah)
    const menitTelat = Math.max(0, diffMinutes - 5); // toleransi 5 menit
    const potongan = menitTelat * 1000; // Rp1.000 per menit

    // 5. Simpan ke database
    const attendance = await prisma.attendance.create({
      data: {
        employeeId: session.user.id,
        storeId: session.user.storeId,
        fotoFileId: uploadResult.fileId,
        status: "PENDING_VERIFIKASI",
        tanggalShift: computeTanggalShiftWIB(shiftMulai),
        shiftMulai,
        shiftSelesai,
        absenWaktu,
        menitTelat,
        potongan,
        latitude,
        longitude,
      },
    });

    // 6. Return record yang dibuat (include menitTelat & potongan untuk konfirmasi)
    return NextResponse.json({
      id: attendance.id,
      employeeId: attendance.employeeId,
      storeId: attendance.storeId,
      fotoFileId: attendance.fotoFileId,
      status: attendance.status,
      tanggalShift: attendance.tanggalShift.toISOString(),
      shiftMulai: attendance.shiftMulai.toISOString(),
      shiftSelesai: attendance.shiftSelesai.toISOString(),
      absenWaktu: attendance.absenWaktu.toISOString(),
      menitTelat: attendance.menitTelat,
      potongan: attendance.potongan,
      latitude: attendance.latitude,
      longitude: attendance.longitude,
      createdAt: attendance.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /api/absensi error:", err);
    if (err instanceof Error) {
      // Handle Telegram upload errors specifically
      if (err.message.includes("Telegram")) {
        return NextResponse.json({ error: `Gagal upload ke Telegram: ${err.message}` }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Gagal memproses absensi. Silakan coba lagi." }, { status: 500 });
  }
}