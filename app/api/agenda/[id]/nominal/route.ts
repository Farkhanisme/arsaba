import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const NOMINAL_MAX = 10_000_000;

type Body = {
  nominal?: unknown;
};

// PATCH /api/agenda/[id]/nominal
// Body: { nominal: number }
// Hanya MANAJER. Set nominal agenda + audit.
// Kalau agenda adalah template master, propagate ke turunan yang nominal-nya masih null.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

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

    const agenda = await prisma.agenda.findUnique({
      where: { id },
      select: {
        id: true,
        sumber: true,
        status: true,
        templateId: true,
      },
    });

    if (!agenda) {
      return NextResponse.json(
        { error: "Agenda tidak ditemukan." },
        { status: 404 }
      );
    }

    const now = new Date();

    // Kasus 1: agenda turunan atau mandiri — set nominal langsung
    if (agenda.templateId !== null) {
      const updated = await prisma.agenda.update({
        where: { id },
        data: {
          nominal,
          nominalSetById: session.user.id,
          nominalSetAt: now,
        },
      });
      return NextResponse.json({
        id: updated.id,
        nominal: updated.nominal,
        propagatedCount: 0,
      });
    }

    // Kasus 2: template master — set + propagate ke turunan yang nominal masih null
    const result = await prisma.$transaction(async (tx) => {
      const master = await tx.agenda.update({
        where: { id },
        data: {
          nominal,
          nominalSetById: session.user.id,
          nominalSetAt: now,
        },
      });

      const propagated = await tx.agenda.updateMany({
        where: {
          templateId: id,
          nominal: null,
        },
        data: {
          nominal,
          nominalSetById: session.user.id,
          nominalSetAt: now,
        },
      });

      return { master, propagatedCount: propagated.count };
    });

    return NextResponse.json({
      id: result.master.id,
      nominal: result.master.nominal,
      propagatedCount: result.propagatedCount,
    });
  } catch (err) {
    console.error("PATCH /api/agenda/[id]/nominal error:", err);
    return NextResponse.json(
      { error: "Gagal menetapkan nominal. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
