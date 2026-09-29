import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTelegramFileUrl } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

const VERIFIER_ROLES = ["SUPERVISOR", "ADMIN", "MANAJER"];

// GET /api/telegram/file/[fileId]
// Proxy file dari Telegram agar TELEGRAM_BOT_TOKEN tidak bocor ke browser.
// URL asli dari getTelegramFileUrl mengandung token — JANGAN pernah dikirim
// ke client secara langsung.
//
// Otorisasi: fileId hanya boleh diambil oleh pemiliknya (karyawan yang absen)
// atau role verifier. Tanpa ini, siapa pun yang login bisa melihat foto
// absensi orang lain selama tahu fileId-nya.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { fileId } = await params;
    if (!fileId || fileId.length < 10 || fileId.length > 200) {
      return NextResponse.json({ error: "fileId tidak valid" }, { status: 400 });
    }

    const role = session.user.role;
    const isVerifier = VERIFIER_ROLES.includes(role);

    // File bisa milik AttendanceLog (foto absensi), BuktiSetoran (bukti setoran)
    // atau Agenda (bukti agenda). Semuanya wajib lolos cek otorisasi dulu.
    //
    // SENGJAJA short-circuit + SEQUENTIAL (bukan Promise.all): Neon pooler
    // free-tier sering drop koneksi (P1001) saat beberapa query paralel dari
    // satu request. Kasus umum (foto absensi) cukup 1 query.
    const log = await prisma.attendanceLog.findFirst({
      where: { fotoFileId: fileId },
      select: { attendance: { select: { employeeId: true } } },
    });
    if (log) {
      if (!isVerifier && log.attendance.employeeId !== session.user.id) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    } else {
      const bukti = await prisma.buktiSetoran.findFirst({
        where: { fileId },
        select: {
          setoran: {
            select: {
              disetorkanOlehId: true,
              diterimaOlehId: true,
              tipeTujuan: true,
              tokoTujuanId: true,
            },
          },
        },
      });
      if (bukti) {
        const { disetorkanOlehId, diterimaOlehId, tipeTujuan, tokoTujuanId } =
          bukti.setoran;
        // Penerima yang BERWEWENANG ikut boleh, bukan cuma yang sudah menerima.
        //
        // Untuk setoran berstatus MENUNGGU_KONFIRMASI, `diterimaOlehId` masih
        // null — jadi KEPALA_TOKO yang seharusnya mengonfirmasi tidak bisa
        // melihat bukti yang harus dia periksa, dan gambarnya gagal load tepat
        // di layar konfirmasi.
        //
        // Aturan ini menyalin PERSIS cek di
        // `app/api/setoran/[id]/terima/route.ts` (cabang TOKO), jadi tidak ada
        // sumber kebenaran kedua. Kalau tidak cocok di sana, tidak cocok di sini.
        const berwenangMenerima =
          role === "KEPALA_TOKO" &&
          tipeTujuan === "TOKO" &&
          tokoTujuanId !== null &&
          session.user.storeId === tokoTujuanId;

        if (
          !isVerifier &&
          !berwenangMenerima &&
          disetorkanOlehId !== session.user.id &&
          diterimaOlehId !== session.user.id
        ) {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
      } else {
        const agenda = await prisma.agenda.findFirst({
          where: { OR: [{ buktiBeforeFileId: fileId }, { buktiAfterFileId: fileId }] },
          select: { targetEmployeeId: true, createdById: true },
        });
        if (!agenda) {
          return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });
        }
        if (
          !isVerifier &&
          agenda.targetEmployeeId !== session.user.id &&
          agenda.createdById !== session.user.id
        ) {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
      }
    }

    const url = await getTelegramFileUrl(fileId);
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Gagal mengambil file dari Telegram." },
        { status: 502 }
      );
    }

    let contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType || contentType === "application/octet-stream") {
      const path = new URL(url).pathname.toLowerCase();
      if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
      else if (path.endsWith(".png")) contentType = "image/png";
      else if (path.endsWith(".webp")) contentType = "image/webp";
      else if (path.endsWith(".gif")) contentType = "image/gif";
      else contentType = "application/octet-stream";
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("GET /api/telegram/file/[fileId] error:", err);
    return NextResponse.json({ error: "Gagal memuat file." }, { status: 500 });
  }
}
