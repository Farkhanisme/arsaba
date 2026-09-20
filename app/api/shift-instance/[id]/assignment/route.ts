import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];
const ALLOWED_EMPLOYEE_ROLES = ["KARYAWAN", "KEPALA_TOKO"];

// POST /api/shift-instance/[id]/assignment
// Body: { employeeId: string }
// Menambah assignment NORMAL untuk karyawan ke shift instance.
// jamMulai/jamSelesai diambil dari instance.
// Kalau instance APPROVED, otomatis direset ke DRAFT (approval tidak valid lagi).
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
        { error: "Role Anda tidak berwenang mengubah assignment." },
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

    const employeeId = body.employeeId;
    if (typeof employeeId !== "string" || employeeId.length === 0) {
      return NextResponse.json(
        { error: "Field 'employeeId' wajib diisi" },
        { status: 400 }
      );
    }

    const instance = await prisma.shiftInstance.findUnique({ where: { id } });
    if (!instance) {
      return NextResponse.json(
        { error: "Jadwal tidak ditemukan." },
        { status: 404 }
      );
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        nama: true,
        role: true,
        status: true,
        storeId: true,
      },
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
    if (employee.storeId !== instance.storeId) {
      return NextResponse.json(
        { error: "Karyawan tidak terdaftar di toko ini." },
        { status: 400 }
      );
    }
    if (!ALLOWED_EMPLOYEE_ROLES.includes(employee.role)) {
      return NextResponse.json(
        { error: "Role karyawan tidak bisa di-assign ke shift." },
        { status: 400 }
      );
    }

    const duplikat = await prisma.shiftAssignment.findFirst({
      where: { shiftInstanceId: id, employeeId },
    });
    if (duplikat) {
      return NextResponse.json(
        { error: "Karyawan sudah di-assign ke shift ini." },
        { status: 409 }
      );
    }

    // Overlap check: assignment lain di tanggal yang sama, intervalnya overlap
    const overlap = await prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        shiftInstance: { tanggal: instance.tanggal },
        jamMulai: { lt: instance.jamSelesai },
        jamSelesai: { gt: instance.jamMulai },
      },
    });
    if (overlap) {
      return NextResponse.json(
        {
          error:
            "Karyawan sudah punya assignment lain di tanggal ini yang jamnya overlap.",
        },
        { status: 409 }
      );
    }

    const created = await prisma.shiftAssignment.create({
      data: {
        shiftInstanceId: id,
        employeeId,
        segmen: "NORMAL",
        jamMulai: instance.jamMulai,
        jamSelesai: instance.jamSelesai,
        createdById: session.user.id,
      },
    });

    let statusInstance: "DRAFT" | "APPROVED" = instance.statusJadwal;
    if (instance.statusJadwal === "APPROVED") {
      await prisma.shiftInstance.update({
        where: { id },
        data: {
          statusJadwal: "DRAFT",
          approvedById: null,
          approvedAt: null,
        },
      });

      const semuaAssignment = await prisma.shiftAssignment.findMany({
        where: { shiftInstanceId: id },
        select: { employeeId: true },
      });
      const employeeIdsReset = [
        ...new Set(semuaAssignment.map((a) => a.employeeId)),
      ];
      if (employeeIdsReset.length > 0) {
        await prisma.attendance.updateMany({
          where: {
            employeeId: { in: employeeIdsReset },
            tanggalShift: instance.tanggal,
          },
          data: {
            shiftMulai: null,
            shiftSelesai: null,
            menitTelat: 0,
            potongan: 0,
          },
        });
      }

      statusInstance = "DRAFT";
    }

    return NextResponse.json({
      id: created.id,
      shiftInstanceId: created.shiftInstanceId,
      employeeId: created.employeeId,
      employeeNama: employee.nama,
      segmen: created.segmen,
      jamMulai: created.jamMulai.toISOString(),
      jamSelesai: created.jamSelesai.toISOString(),
      createdAt: created.createdAt.toISOString(),
      instanceStatusBaru: statusInstance,
    });
  } catch (err) {
    console.error("POST /api/shift-instance/[id]/assignment error:", err);
    return NextResponse.json(
      { error: "Gagal menambahkan assignment." },
      { status: 500 }
    );
  }
}
