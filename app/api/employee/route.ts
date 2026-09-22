import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role, TipePerhitunganGaji } from "@prisma/client";

const PII_FIELDS = ["nik", "tempatLahir", "tanggalLahir", "alamat", "kontakDarurat"] as const;

const ALLOWED_READ_ROLES: Role[] = [
  "ADMIN",
  "MANAJER",
  "SUPERVISOR",
  "KEPALA_TOKO",
  "KARYAWAN",
  "DIREKTUR",
];
const ALLOWED_WRITE_ROLES: Role[] = ["ADMIN", "MANAJER"];

type EmployeeInput = {
  nama: string;
  role?: Role;
  tipePerhitunganGaji: TipePerhitunganGaji;
  storeId?: string | null;
  nik?: string | null;
  tempatLahir?: string | null;
  tanggalLahir?: string | null; // ISO date string
  alamat?: string | null;
  kontakDarurat?: string | null;
};

function validateEmployeeInput(raw: unknown): { ok: true; value: EmployeeInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Body harus berupa object." };
  }
  const r = raw as Record<string, unknown>;

  const nama = r.nama;
  if (typeof nama !== "string" || nama.trim().length < 2) {
    return { ok: false, error: "Field 'nama' wajib diisi, minimal 2 karakter." };
  }

  const tipePerhitunganGaji = r.tipePerhitunganGaji;
  if (typeof tipePerhitunganGaji !== "string" || !["HARIAN", "BULANAN", "JAM"].includes(tipePerhitunganGaji)) {
    return { ok: false, error: "Field 'tipePerhitunganGaji' wajib diisi: HARIAN | BULANAN | JAM." };
  }

  let role: Role | undefined;
  if (r.role !== undefined) {
    if (typeof r.role !== "string" || !["DIREKTUR", "MANAJER", "SUPERVISOR", "ADMIN", "KEPALA_TOKO", "KARYAWAN"].includes(r.role)) {
      return { ok: false, error: "Field 'role' tidak valid." };
    }
    role = r.role as Role;
  }

  let storeId: string | null | undefined;
  if (r.storeId !== undefined) {
    if (r.storeId === null || r.storeId === "") {
      storeId = null;
    } else if (typeof r.storeId === "string") {
      storeId = r.storeId;
    } else {
      return { ok: false, error: "Field 'storeId' harus string atau null." };
    }
  }

  const validateOptionalString = (field: string, value: unknown) => {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `Field '${field}' harus string atau null.`;
    }
    return null;
  };

  for (const field of PII_FIELDS) {
    const err = validateOptionalString(field, r[field]);
    if (err) return { ok: false, error: err };
  }

  return {
    ok: true,
    value: {
      nama: nama.trim(),
      role,
      tipePerhitunganGaji: tipePerhitunganGaji as TipePerhitunganGaji,
      storeId,
      nik: (r.nik as string | null | undefined) ?? null,
      tempatLahir: (r.tempatLahir as string | null | undefined) ?? null,
      tanggalLahir: (r.tanggalLahir as string | null | undefined) ?? null,
      alamat: (r.alamat as string | null | undefined) ?? null,
      kontakDarurat: (r.kontakDarurat as string | null | undefined) ?? null,
    },
  };
}

// GET /api/employee — list karyawan
// PII protection: non-Admin/Manajer tidak menerima field PII
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }
    if (!ALLOWED_READ_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar karyawan." },
        { status: 403 }
      );
    }

    const isAdminOrManajer = session.user.role === "ADMIN" || session.user.role === "MANAJER";

    // Build select dynamically based on role
    const baseSelect = {
      id: true,
      kode: true,
      nama: true,
      role: true,
      status: true,
      tipePerhitunganGaji: true,
      tarifPerJam: true,
      tanggalMasuk: true,
      storeId: true,
      store: { select: { id: true, nama: true } },
      createdAt: true,
      updatedAt: true,
    };

    const select = isAdminOrManajer
      ? { ...baseSelect, nik: true, tempatLahir: true, tanggalLahir: true, alamat: true, kontakDarurat: true }
      : baseSelect;

    const items = await prisma.user.findMany({
      where: {
        role: { in: ["KARYAWAN", "KEPALA_TOKO", "ADMIN", "SUPERVISOR", "MANAJER", "DIREKTUR"] },
      },
      orderBy: { kode: "asc" },
      select,
    });

    return NextResponse.json({
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("GET /api/employee error:", err);
    return NextResponse.json({ error: "Gagal mengambil daftar karyawan." }, { status: 500 });
  }
}

// POST /api/employee — create karyawan
// Hanya ADMIN & MANAJER
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }
    if (!ALLOWED_WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang membuat karyawan." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const validation = validateEmployeeInput(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const input = validation.value;

    // Validate storeId exists if provided
    if (input.storeId) {
      const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
      if (!store) {
        return NextResponse.json({ error: "Store tidak ditemukan." }, { status: 400 });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      // 1. Lock & Update KodeCounter
      const counter = await tx.kodeCounter.update({
        where: { prefix: "EMP" },
        data: { lastNumber: { increment: 1 } },
      });
      const kode = `EMP-${String(counter.lastNumber).padStart(3, "0")}`;

      // 2. Create User
      const user = await tx.user.create({
        data: {
          kode,
          nama: input.nama,
          role: input.role ?? "KARYAWAN",
          tipePerhitunganGaji: input.tipePerhitunganGaji,
          storeId: input.storeId ?? null,
          nik: input.nik,
          tempatLahir: input.tempatLahir,
          tanggalLahir: input.tanggalLahir ? new Date(input.tanggalLahir) : null,
          alamat: input.alamat,
          kontakDarurat: input.kontakDarurat,
        },
      });

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          tabel: "User",
          recordId: user.id,
          aksi: "CREATE",
          nilaiSesudah: { kode: user.kode, nama: user.nama, role: user.role },
          actorId: session.user.id,
        },
      });

      return user;
    });

    // Return response with PII protection
    const isAdminOrManajer = session.user.role === "ADMIN" || session.user.role === "MANAJER";
    const responseData: Record<string, unknown> = {
      id: created.id,
      kode: created.kode,
      nama: created.nama,
      role: created.role,
      status: created.status,
      tipePerhitunganGaji: created.tipePerhitunganGaji,
      tarifPerJam: created.tarifPerJam,
      tanggalMasuk: created.tanggalMasuk,
      storeId: created.storeId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };

    if (isAdminOrManajer) {
      responseData.nik = created.nik;
      responseData.tempatLahir = created.tempatLahir;
      responseData.tanggalLahir = created.tanggalLahir;
      responseData.alamat = created.alamat;
      responseData.kontakDarurat = created.kontakDarurat;
    }

    return NextResponse.json(responseData, { status: 201 });
  } catch (err) {
    console.error("POST /api/employee error:", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      // Unique constraint violation (nik or kode)
      const meta = (err as { meta?: { target?: string[] } }).meta;
      const field = meta?.target?.[0] === "nik" ? "NIK" : "Kode karyawan";
      return NextResponse.json({ error: `${field} sudah terdaftar.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Gagal membuat karyawan." }, { status: 500 });
  }
}