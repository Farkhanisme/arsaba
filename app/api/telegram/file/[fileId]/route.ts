import { auth } from "@/auth";
import { getTelegramFileUrl } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

// GET /api/telegram/file/[fileId]
// Proxy file dari Telegram agar TELEGRAM_BOT_TOKEN tidak bocor ke browser.
// URL asli dari getTelegramFileUrl mengandung token — JANGAN pernah dikirim
// ke client secara langsung.
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
