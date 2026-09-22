import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_READ_ROLES: Role[] = ["ADMIN", "MANAJER", "SUPERVISOR"];
const ALLOWED_WRITE_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

type ShiftInput = {
  nama: string;
  jamMulaiMenit: number;
  jamSelesaiMenit: number;
  lintasHari: boolean;
};

function validateShiftInput(raw: unknown, index: number): { ok: true; value: ShiftInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: `shifts[${index}] harus object.` };
  }
  const r = raw as Record<string, unknown>;

  const nama = r.nama;
  if (typeof nama !== "string" || nama.trim().length < 2 || nama.trim().length > 30) {
    return { ok: false, error: `shifts[${index}].nama harus 2-30 karakter.` };
  }
  const jamMulaiMenit = r.jamMulaiMenit;
  if (typeof jamMulaiMenit !== "number" || !Number.isInteger(jamMulaiMenit) || jamMulaiMenit < 0 || jamMulaiMenit > 1439) {
    return { ok: false, error: `shifts[${index}].jamMulaiMenit harus integer 0-1439.` };
  }
  const jamSelesaiMenit = r.jamSelesaiMenit;
  if (typeof jamSelesaiMenit !== "number" || !Number.isInteger(jamSelesaiMenit) || jamSelesaiMenit < 0 || jamSelesaiMenit > 1439) {
    return { ok: false, error: `shifts[${index}].jamSelesaiMenit harus integer 0-1439.` };
  }
  const lintasHari = r.lintasHari;
  if (typeof lintasHari !== "boolean") {
    return { ok: false, error: `shifts[${index}].lintasHari harus boolean.` };
  }
  if (!lintasHari && jamSelesaiMenit <= jamMulaiMenit) {
    return { ok: false, error: `shifts[${index}]: jika lintasHari=false, jamSelesaiMenit harus > jamMulaiMenit.` };
  }
  if (lintasHari && jamSelesaiMenit > jamMulaiMenit) {
    return { ok: false, error: `shifts[${index}]: jika lintasHari=true, jamSelesaiMenit harus <= jamMulaiMenit.` };
  }
  return { ok: true, value: { nama: nama.trim(), jamMulaiMenit, jamSelesaiMenit, lintasHari } };
}

// GET /api/store — list semua toko.
// Query opsional: ?aktif=true
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_READ_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang melihat daftar toko." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const aktifParam = searchParams.get("aktif");

    const where: Record<string, unknown> = {};
    if (aktifParam === "true") {
      where.aktif = true;
    } else if (aktifParam === "false") {
      where.aktif = false;
    }

    const items = await prisma.store.findMany({
      where,
      orderBy: { nama: "asc" },
      select: {
        id: true,
        nama: true,
        alias: true,
        aktif: true,
        pamEnabled: true,
      },
    });

    return NextResponse.json({
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("GET /api/store error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar toko." },
      { status: 500 }
    );
  }
}

// POST /api/store — bikin toko baru. Hanya ADMIN.
// Body: { nama, alias?, pamEnabled?, shifts? }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }
    if (!ALLOWED_WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang membuat toko." },
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

    const alias =
      typeof body.alias === "string" && body.alias.trim().length > 0
        ? body.alias.trim()
        : null;

    let pamEnabled = true;
    if (body.pamEnabled !== undefined) {
      if (typeof body.pamEnabled !== "boolean") {
        return NextResponse.json(
          { error: "Field 'pamEnabled' harus boolean bila diisi." },
          { status: 400 }
        );
      }
      pamEnabled = body.pamEnabled;
    }

    let shifts: ShiftInput[] = [];
    if (body.shifts !== undefined) {
      if (!Array.isArray(body.shifts)) {
        return NextResponse.json(
          { error: "Field 'shifts' harus array." },
          { status: 400 }
        );
      }
      const parsed: ShiftInput[] = [];
      for (let i = 0; i < body.shifts.length; i++) {
        const result = validateShiftInput(body.shifts[i], i);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        parsed.push(result.value);
      }
      // Cek nama duplikat dalam array
      const names = new Set<string>();
      for (const s of parsed) {
        if (names.has(s.nama)) {
          return NextResponse.json(
            { error: `Nama shift "${s.nama}" duplikat dalam array.` },
            { status: 400 }
          );
        }
        names.add(s.nama);
      }
      shifts = parsed;
    }

    const created = await prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          nama: nama.trim(),
          alias,
          pamEnabled,
        },
      });

      const auditEntries: Array<{
        tabel: string;
        recordId: string;
        aksi: string;
        nilaiSesudah: any;
        actorId: string;
      }> = [];

      // Audit log: CREATE_STORE
      auditEntries.push({
        tabel: "Store",
        recordId: store.id,
        aksi: "CREATE",
        nilaiSesudah: { nama: store.nama, alias: store.alias, pamEnabled: store.pamEnabled },
        actorId: session.user.id,
      });

      if (shifts.length > 0) {
        await tx.shiftTemplate.createMany({
          data: shifts.map((s) => ({
            storeId: store.id,
            nama: s.nama,
            jamMulaiMenit: s.jamMulaiMenit,
            jamSelesaiMenit: s.jamSelesaiMenit,
            lintasHari: s.lintasHari,
          })),
        });

        // Audit log: CREATE_SHIFT (per shift)
        for (const s of shifts) {
          auditEntries.push({
            tabel: "ShiftTemplate",
            recordId: store.id,
            aksi: "CREATE",
            nilaiSesudah: { nama: s.nama, jamMulaiMenit: s.jamMulaiMenit, jamSelesaiMenit: s.jamSelesaiMenit, lintasHari: s.lintasHari, storeId: store.id },
            actorId: session.user.id,
          });
        }
      }

      if (auditEntries.length > 0) {
        await tx.auditLog.createMany({ data: auditEntries });
      }

      return store;
    });

    return NextResponse.json({
      id: created.id,
      nama: created.nama,
      alias: created.alias,
      aktif: created.aktif,
      pamEnabled: created.pamEnabled,
      shiftsCount: shifts.length,
    });
  } catch (err) {
    console.error("POST /api/store error:", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Nama shift duplikat di toko ini." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Gagal membuat toko." },
      { status: 500 }
    );
  }
}
