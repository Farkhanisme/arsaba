import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES = ["ADMIN", "SUPERVISOR", "MANAJER"];
const ASSIGNABLE_EMPLOYEE_ROLES: Role[] = ["KARYAWAN", "KEPALA_TOKO"];

type TargetType = "EMPLOYEE" | "STORE";

type Body = {
  targetType?: unknown;
  targetId?: unknown;
};

// POST /api/agenda/[id]/assign
// Body: { targetType: "EMPLOYEE" | "STORE", targetId: string }
// Assign template master ke karyawan (1 row) atau ke toko (expand per karyawan AKTIF).
export async function POST(
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
        { error: "Role Anda tidak berwenang meng-assign agenda." },
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

    const targetType = body.targetType;
    if (targetType !== "EMPLOYEE" && targetType !== "STORE") {
      return NextResponse.json(
        { error: "Field 'targetType' harus 'EMPLOYEE' atau 'STORE'." },
        { status: 400 }
      );
    }

    const targetId = body.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      return NextResponse.json(
        { error: "Field 'targetId' wajib diisi." },
        { status: 400 }
      );
    }

    // Ambil template master
    const template = await prisma.agenda.findUnique({
      where: { id },
    });
    if (!template) {
      return NextResponse.json(
        { error: "Template agenda tidak ditemukan." },
        { status: 404 }
      );
    }
    if (template.sumber !== "TEMPLATE_PUSAT") {
      return NextResponse.json(
        { error: "Hanya agenda dengan sumber TEMPLATE_PUSAT yang bisa di-assign." },
        { status: 400 }
      );
    }
    if (template.targetEmployeeId !== null || template.targetStoreId !== null) {
      return NextResponse.json(
        { error: "Agenda ini sudah punya target, bukan template master." },
        { status: 400 }
      );
    }

    const dataDasar = {
      judul: template.judul,
      deskripsi: template.deskripsi,
      nominal: template.nominal,
      sumber: template.sumber,
      deadline: template.deadline,
      templateId: template.id,
      createdById: session.user.id,
    };

    if (targetType === "EMPLOYEE") {
      const employee = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, nama: true, role: true, status: true },
      });
      if (!employee) {
        return NextResponse.json(
          { error: "Karyawan tidak ditemukan." },
          { status: 404 }
        );
      }
      if (employee.status !== "AKTIF") {
        return NextResponse.json(
          { error: "Karyawan tidak berstatus AKTIF." },
          { status: 400 }
        );
      }
      if (!ASSIGNABLE_EMPLOYEE_ROLES.includes(employee.role)) {
        return NextResponse.json(
          { error: "Role karyawan tidak bisa di-assign agenda." },
          { status: 400 }
        );
      }

      const created = await prisma.agenda.create({
        data: {
          ...dataDasar,
          targetEmployeeId: employee.id,
        },
      });

      return NextResponse.json({
        targetType: "EMPLOYEE",
        count: 1,
        ids: [created.id],
      });
    }

    // targetType === "STORE"
    const store = await prisma.store.findUnique({
      where: { id: targetId },
      select: { id: true, nama: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: "Toko tidak ditemukan." },
        { status: 404 }
      );
    }

    const karyawanList = await prisma.user.findMany({
      where: {
        storeId: store.id,
        status: "AKTIF",
        role: { in: ASSIGNABLE_EMPLOYEE_ROLES },
      },
      select: { id: true },
    });

    if (karyawanList.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada karyawan AKTIF di toko ini yang bisa di-assign." },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(
      karyawanList.map((k) =>
        prisma.agenda.create({
          data: {
            ...dataDasar,
            targetStoreId: store.id,
            targetEmployeeId: k.id,
          },
        })
      )
    );

    return NextResponse.json({
      targetType: "STORE",
      storeNama: store.nama,
      count: created.length,
      ids: created.map((c) => c.id),
    });
  } catch (err) {
    console.error("POST /api/agenda/[id]/assign error:", err);
    return NextResponse.json(
      { error: "Gagal meng-assign agenda." },
      { status: 500 }
    );
  }
}
