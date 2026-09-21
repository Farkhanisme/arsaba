import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_CREATE_ROLES = ["ADMIN", "SUPERVISOR", "MANAJER"];
const ALLOWED_LIST_ROLES = [
  "DIREKTUR",
  "MANAJER",
  "SUPERVISOR",
  "ADMIN",
  "KEPALA_TOKO",
  "KARYAWAN",
];

// POST /api/agenda — bikin TEMPLATE master (sumber TEMPLATE_PUSAT, tanpa target).
// Body: { judul, deskripsi?, nominal, deadline? }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_CREATE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang membuat template agenda." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const judul = body.judul;
    if (typeof judul !== "string" || judul.trim().length < 3) {
      return NextResponse.json(
        { error: "Field 'judul' wajib diisi, minimal 3 karakter." },
        { status: 400 }
      );
    }

    const deskripsi =
      typeof body.deskripsi === "string" && body.deskripsi.trim().length > 0
        ? body.deskripsi.trim()
        : null;

    const nominal = body.nominal;
    if (
      typeof nominal !== "number" ||
      !Number.isInteger(nominal) ||
      nominal < 0
    ) {
      return NextResponse.json(
        { error: "Field 'nominal' wajib diisi (integer >= 0)." },
        { status: 400 }
      );
    }

    let deadline: Date | null = null;
    if (body.deadline !== undefined && body.deadline !== null) {
      if (typeof body.deadline !== "string") {
        return NextResponse.json(
          { error: "Field 'deadline' harus string format YYYY-MM-DD." },
          { status: 400 }
        );
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.deadline);
      if (!m) {
        return NextResponse.json(
          { error: "Field 'deadline' harus format YYYY-MM-DD." },
          { status: 400 }
        );
      }
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const parsed = new Date(Date.UTC(y, mo - 1, d));
      if (
        parsed.getUTCFullYear() !== y ||
        parsed.getUTCMonth() !== mo - 1 ||
        parsed.getUTCDate() !== d
      ) {
        return NextResponse.json(
          { error: "Field 'deadline' bukan tanggal yang valid." },
          { status: 400 }
        );
      }
      deadline = parsed;
    }

    const created = await prisma.agenda.create({
      data: {
        judul: judul.trim(),
        deskripsi,
        nominal,
        sumber: "TEMPLATE_PUSAT",
        targetStoreId: null,
        targetEmployeeId: null,
        deadline,
        createdById: session.user.id,
      },
    });

    return NextResponse.json({
      id: created.id,
      judul: created.judul,
      deskripsi: created.deskripsi,
      nominal: created.nominal,
      sumber: created.sumber,
      deadline: created.deadline ? created.deadline.toISOString() : null,
      status: created.status,
      templateId: created.templateId,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /api/agenda error:", err);
    return NextResponse.json(
      { error: "Gagal membuat template agenda." },
      { status: 500 }
    );
  }
}

// GET /api/agenda — list agenda by role.
// Query opsional: ?status=DIVERIFIKASI&storeId=xxx
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_LIST_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat agenda." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const storeIdParam = searchParams.get("storeId");

    const where: Record<string, unknown> = {};

    // Karyawan & Kepala Toko: hanya agenda yang di-assign ke dirinya
    if (session.user.role === "KARYAWAN" || session.user.role === "KEPALA_TOKO") {
      where.targetEmployeeId = session.user.id;
    } else if (storeIdParam) {
      where.targetStoreId = storeIdParam;
    }

    if (statusParam) {
      if (
        statusParam !== "PENDING_VERIFIKASI" &&
        statusParam !== "DIVERIFIKASI" &&
        statusParam !== "DITOLAK"
      ) {
        return NextResponse.json(
          {
            error:
              "Field 'status' harus PENDING_VERIFIKASI, DIVERIFIKASI, atau DITOLAK.",
          },
          { status: 400 }
        );
      }
      where.status = statusParam;
    }

    const items = await prisma.agenda.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        targetStore: { select: { nama: true } },
        targetEmployee: { select: { nama: true } },
        verifiedBy: { select: { nama: true } },
      },
    });

    return NextResponse.json({
      total: items.length,
      items: items.map((a) => ({
        id: a.id,
        judul: a.judul,
        deskripsi: a.deskripsi,
        nominal: a.nominal,
        sumber: a.sumber,
        deadline: a.deadline ? a.deadline.toISOString() : null,
        targetStoreId: a.targetStoreId,
        targetStoreNama: a.targetStore?.nama ?? null,
        targetEmployeeId: a.targetEmployeeId,
        targetEmployeeNama: a.targetEmployee?.nama ?? null,
        status: a.status,
        buktiBeforeFileId: a.buktiBeforeFileId,
        buktiAfterFileId: a.buktiAfterFileId,
        diselesaikanPada: a.diselesaikanPada
          ? a.diselesaikanPada.toISOString()
          : null,
        verifiedAt: a.verifiedAt ? a.verifiedAt.toISOString() : null,
        verifiedByNama: a.verifiedBy?.nama ?? null,
        templateId: a.templateId,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /api/agenda error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar agenda." },
      { status: 500 }
    );
  }
}
