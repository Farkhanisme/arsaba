import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];

// GET /api/shift-instance/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengakses jadwal." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const x = await prisma.shiftInstance.findUnique({
      where: { id },
      include: {
        store: { select: { nama: true } },
        template: {
          select: {
            nama: true,
            jamMulaiMenit: true,
            jamSelesaiMenit: true,
            lintasHari: true,
          },
        },
        createdBy: { select: { nama: true } },
        approvedBy: { select: { nama: true } },
        assignments: {
          orderBy: { createdAt: "asc" },
          include: {
            employee: { select: { nama: true } },
            createdBy: { select: { nama: true } },
          },
        },
      },
    });

    if (!x) {
      return NextResponse.json(
        { error: "Jadwal tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: x.id,
      storeId: x.storeId,
      storeNama: x.store.nama,
      templateId: x.templateId,
      template: x.template
        ? {
            nama: x.template.nama,
            jamMulaiMenit: x.template.jamMulaiMenit,
            jamSelesaiMenit: x.template.jamSelesaiMenit,
            lintasHari: x.template.lintasHari,
          }
        : null,
      tanggal: x.tanggal.toISOString().slice(0, 10),
      jamMulai: x.jamMulai.toISOString(),
      jamSelesai: x.jamSelesai.toISOString(),
      statusJadwal: x.statusJadwal,
      sumberJadwal: x.sumberJadwal,
      batchId: x.batchId,
      catatan: x.catatan,
      createdByName: x.createdBy.nama,
      approvedByName: x.approvedBy?.nama ?? null,
      approvedAt: x.approvedAt ? x.approvedAt.toISOString() : null,
      assignments: x.assignments.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        employeeNama: a.employee.nama,
        segmen: a.segmen,
        jamMulai: a.jamMulai.toISOString(),
        jamSelesai: a.jamSelesai.toISOString(),
        createdByName: a.createdBy.nama,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /api/shift-instance/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal memuat jadwal." },
      { status: 500 }
    );
  }
}

// PATCH /api/shift-instance/[id] — approve
// Body: { action: "approve" }
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
        { error: "Role Anda tidak berwenang mengubah jadwal." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const action = body.action;
    if (action !== "approve") {
      return NextResponse.json(
        { error: "Field 'action' harus 'approve'" },
        { status: 400 }
      );
    }

    const existing = await prisma.shiftInstance.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Jadwal tidak ditemukan." }, { status: 404 });
    }
    if (existing.statusJadwal === "APPROVED") {
      return NextResponse.json(
        { error: "Jadwal ini sudah APPROVED." },
        { status: 409 }
      );
    }

    const now = new Date();
    const updated = await prisma.shiftInstance.update({
      where: { id },
      data: {
        statusJadwal: "APPROVED",
        approvedById: session.user.id,
        approvedAt: now,
      },
    });

    return NextResponse.json({
      id: updated.id,
      statusJadwal: updated.statusJadwal,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
    });
  } catch (err) {
    console.error("PATCH /api/shift-instance/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal approve jadwal." },
      { status: 500 }
    );
  }
}

// DELETE /api/shift-instance/[id] — hanya DRAFT, CASCADE hapus assignment
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang menghapus jadwal." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const existing = await prisma.shiftInstance.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Jadwal tidak ditemukan." }, { status: 404 });
    }
    if (existing.statusJadwal === "APPROVED") {
      return NextResponse.json(
        { error: "Jadwal APPROVED tidak bisa dihapus." },
        { status: 409 }
      );
    }

    await prisma.shiftInstance.delete({ where: { id } });
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/shift-instance/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus jadwal." },
      { status: 500 }
    );
  }
}
