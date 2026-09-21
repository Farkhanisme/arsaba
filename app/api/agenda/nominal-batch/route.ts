import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const NOMINAL_MAX = 10_000_000;

type Body = {
  nominal?: unknown;
  sumber?: unknown;
  templateId?: unknown;
};

// POST /api/agenda/nominal-batch
// Body: { nominal: number, sumber?: "TEMPLATE_PUSAT" | "MANDIRI_KARYAWAN", templateId?: string }
// Hanya MANAJER. Set nominal untuk semua agenda DIVERIFIKASI yang nominal-nya masih null.
// Minimal salah satu filter (sumber / templateId) wajib diisi.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya Manajer yang berwenang menetapkan nominal." },
        { status: 403 }
      );
    }

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const nominal = body.nominal;
    if (
      typeof nominal !== "number" ||
      !Number.isInteger(nominal) ||
      nominal < 0 ||
      nominal > NOMINAL_MAX
    ) {
      return NextResponse.json(
        { error: `Field 'nominal' wajib integer 0-${NOMINAL_MAX}.` },
        { status: 400 }
      );
    }

    const sumberFilter = body.sumber;
    const templateIdFilter = body.templateId;

    if (sumberFilter === undefined && templateIdFilter === undefined) {
      return NextResponse.json(
        {
          error:
            "Minimal salah satu filter wajib diisi: 'sumber' atau 'templateId'.",
        },
        { status: 400 }
      );
    }

    if (
      sumberFilter !== undefined &&
      sumberFilter !== "TEMPLATE_PUSAT" &&
      sumberFilter !== "MANDIRI_KARYAWAN"
    ) {
      return NextResponse.json(
        {
          error:
            "Field 'sumber' harus 'TEMPLATE_PUSAT' atau 'MANDIRI_KARYAWAN'.",
        },
        { status: 400 }
      );
    }

    if (
      templateIdFilter !== undefined &&
      (typeof templateIdFilter !== "string" || templateIdFilter.length === 0)
    ) {
      return NextResponse.json(
        { error: "Field 'templateId' harus string non-empty." },
        { status: 400 }
      );
    }

    const where: Record<string, unknown> = {
      status: "DIVERIFIKASI",
      nominal: null,
    };
    if (sumberFilter !== undefined) {
      where.sumber = sumberFilter;
    }
    if (templateIdFilter !== undefined) {
      where.templateId = templateIdFilter;
    }

    const now = new Date();
    const result = await prisma.agenda.updateMany({
      where,
      data: {
        nominal,
        nominalSetById: session.user.id,
        nominalSetAt: now,
      },
    });

    return NextResponse.json({
      updated: result.count,
    });
  } catch (err) {
    console.error("POST /api/agenda/nominal-batch error:", err);
    return NextResponse.json(
      { error: "Gagal menetapkan nominal batch. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
