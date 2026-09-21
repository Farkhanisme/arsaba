import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";

const ALLOWED_READ_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER", "DIREKTUR"];
const ALLOWED_WRITE_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const ASSIGNABLE_ROLES: Role[] = [
  "KARYAWAN",
  "KEPALA_TOKO",
  "SUPERVISOR",
  "ADMIN",
  "MANAJER",
  "DIREKTUR",
];

// GET /api/user — list user. Query: ?role=xxx&storeId=xxx&status=xxx
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_READ_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar karyawan." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const roleParam = searchParams.get("role");
    const storeIdParam = searchParams.get("storeId");
    const statusParam = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (roleParam) {
      if (!ASSIGNABLE_ROLES.includes(roleParam as Role)) {
        return NextResponse.json(
          { error: "Field 'role' tidak valid." },
          { status: 400 }
        );
      }
      where.role = roleParam;
    }
    if (storeIdParam) {
      where.storeId = storeIdParam;
    }
    if (statusParam) {
      if (
        statusParam !== "AKTIF" &&
        statusParam !== "RESIGN" &&
        statusParam !== "NONAKTIF"
      ) {
        return NextResponse.json(
          { error: "Field 'status' tidak valid." },
          { status: 400 }
        );
      }
      where.status = statusParam;
    }

    const items = await prisma.user.findMany({
      where,
      orderBy: { nama: "asc" },
      take: 200,
      select: {
        id: true,
        nama: true,
        email: true,
        role: true,
        status: true,
        storeId: true,
        store: { select: { nama: true } },
        tanggalMasuk: true,
        tipePerhitunganGaji: true,
        tarifPerJam: true,
      },
    });

    return NextResponse.json({
      total: items.length,
      items: items.map((u) => ({
        id: u.id,
        nama: u.nama,
        email: u.email,
        role: u.role,
        status: u.status,
        storeId: u.storeId,
        storeNama: u.store?.nama ?? null,
        tanggalMasuk: u.tanggalMasuk ? u.tanggalMasuk.toISOString() : null,
        tipePerhitunganGaji: u.tipePerhitunganGaji,
        tarifPerJam: u.tarifPerJam,
      })),
    });
  } catch (err) {
    console.error("GET /api/user error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar karyawan." },
      { status: 500 }
    );
  }
}

// POST /api/user — bikin user baru. Body: { nama, email, password, role, storeId?, tanggalMasuk? }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang membuat user." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const nama = body.nama;
    if (typeof nama !== "string" || nama.trim().length < 2) {
      return NextResponse.json(
        { error: "Field 'nama' wajib diisi, minimal 2 karakter." },
        { status: 400 }
      );
    }

    const email = body.email;
    if (typeof email !== "string" || !email.includes("@") || email.trim().length < 5) {
      return NextResponse.json(
        { error: "Field 'email' wajib diisi dengan format valid." },
        { status: 400 }
      );
    }

    const password = body.password;
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Field 'password' wajib diisi, minimal 6 karakter." },
        { status: 400 }
      );
    }

    const role = body.role;
    if (typeof role !== "string" || !ASSIGNABLE_ROLES.includes(role as Role)) {
      return NextResponse.json(
        { error: "Field 'role' wajib diisi dan valid." },
        { status: 400 }
      );
    }

    const storeId =
      typeof body.storeId === "string" && body.storeId.length > 0
        ? body.storeId
        : null;

    let tanggalMasuk: Date | null = null;
    if (body.tanggalMasuk !== undefined && body.tanggalMasuk !== null) {
      if (typeof body.tanggalMasuk !== "string") {
        return NextResponse.json(
          { error: "Field 'tanggalMasuk' harus string format YYYY-MM-DD." },
          { status: 400 }
        );
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.tanggalMasuk);
      if (!m) {
        return NextResponse.json(
          { error: "Field 'tanggalMasuk' harus format YYYY-MM-DD." },
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
          { error: "Field 'tanggalMasuk' bukan tanggal valid." },
          { status: 400 }
        );
      }
      tanggalMasuk = parsed;
    }

    const emailTrim = email.trim().toLowerCase();
    const duplikat = await prisma.user.findUnique({
      where: { email: emailTrim },
    });
    if (duplikat) {
      return NextResponse.json(
        { error: "Email sudah terdaftar." },
        { status: 409 }
      );
    }

    if (storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) {
        return NextResponse.json(
          { error: "Toko tidak ditemukan." },
          { status: 404 }
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await prisma.user.create({
      data: {
        nama: nama.trim(),
        email: emailTrim,
        hashedPassword,
        role: role as Role,
        storeId,
        tanggalMasuk,
      },
    });

    return NextResponse.json({
      id: created.id,
      nama: created.nama,
      email: created.email,
      role: created.role,
      status: created.status,
      storeId: created.storeId,
      tanggalMasuk: created.tanggalMasuk
        ? created.tanggalMasuk.toISOString()
        : null,
    });
  } catch (err) {
    console.error("POST /api/user error:", err);
    return NextResponse.json(
      { error: "Gagal membuat user." },
      { status: 500 }
    );
  }
}
