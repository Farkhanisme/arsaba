import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const NOMINAL_MAX = 10_000_000;

type Action = "approve" | "reject";

type Body = {
  action?: unknown;
  reason?: unknown;
  nominal?: unknown;
};

// PATCH /api/agenda/[id]/verify
// Body: { action: "approve" | "reject", reason?: string, nominal?: number }
// - approve MANDIRI_KARYAWAN: nominal WAJIB
// - approve TEMPLATE_PUSAT turunan: nominal opsional (override)
// - reject: reason WAJIB
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
        { error: "Role Anda tidak berwenang memverifikasi agenda." },
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

    const action = body.action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Field 'action' harus 'approve' atau 'reject'." },
        { status: 400 }
      );
    }

    const agenda = await prisma.agenda.findUnique({
      where: { id },
      select: {
        id: true,
        sumber: true,
        status: true,
        nominal: true,
      },
    });
    if (!agenda) {
      return NextResponse.json(
        { error: "Agenda tidak ditemukan." },
        { status: 404 }
      );
    }
    if (agenda.status !== "PENDING_VERIFIKASI") {
      return NextResponse.json(
        { error: "Agenda ini sudah diverifikasi atau ditolak." },
        { status: 409 }
      );
    }

    const now = new Date();

    if (action === "reject") {
      const reason = body.reason;
      if (typeof reason !== "string" || reason.trim().length < 3) {
        return NextResponse.json(
          { error: "Alasan penolakan wajib diisi, minimal 3 karakter." },
          { status: 400 }
        );
      }

      const updated = await prisma.agenda.update({
        where: { id },
        data: {
          status: "DITOLAK",
          verifiedById: session.user.id,
          verifiedAt: now,
        },
      });

      return NextResponse.json({
        id: updated.id,
        status: updated.status,
        verifiedAt: updated.verifiedAt
          ? updated.verifiedAt.toISOString()
          : null,
      });
    }

    // action === "approve"
    let nominalBaru = agenda.nominal;

    if (agenda.sumber === "MANDIRI_KARYAWAN") {
      const nominal = body.nominal;
      if (
        typeof nominal !== "number" ||
        !Number.isInteger(nominal) ||
        nominal < 0 ||
        nominal > NOMINAL_MAX
      ) {
        return NextResponse.json(
          {
            error: `Untuk agenda mandiri, field 'nominal' wajib diisi (integer 0-${NOMINAL_MAX}).`,
          },
          { status: 400 }
        );
      }
      nominalBaru = nominal;
    } else {
      // TEMPLATE_PUSAT turunan: nominal opsional (override)
      if (body.nominal !== undefined) {
        const nominal = body.nominal;
        if (
          typeof nominal !== "number" ||
          !Number.isInteger(nominal) ||
          nominal < 0 ||
          nominal > NOMINAL_MAX
        ) {
          return NextResponse.json(
            { error: `Field 'nominal' harus integer 0-${NOMINAL_MAX}.` },
            { status: 400 }
          );
        }
        nominalBaru = nominal;
      }
    }

    const updated = await prisma.agenda.update({
      where: { id },
      data: {
        status: "DIVERIFIKASI",
        nominal: nominalBaru,
        verifiedById: session.user.id,
        verifiedAt: now,
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      nominal: updated.nominal,
      verifiedAt: updated.verifiedAt
        ? updated.verifiedAt.toISOString()
        : null,
    });
  } catch (err) {
    console.error("PATCH /api/agenda/[id]/verify error:", err);
    return NextResponse.json(
      { error: "Gagal memverifikasi agenda. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
