import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { payrollLocked, pesanPayrollLocked } from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const NOMINAL_MAX = 10_000_000;

type Body = {
  nominal?: unknown;
  alasan?: unknown;
};

// PATCH /api/agenda/[id]/nominal
// Body: { nominal: number, alasan?: string }
// Hanya MANAJER. Mengubah FIELD UANG — wajib jejak audit (spesifikasi §8:415).
//
// Aturan yang ditegakkan di sini:
//   1. Hanya agenda DIVERIFIKASI yang boleh punya nominal. Agenda PENDING
//      (belum dikerjakan) atau DITOLAK tidak boleh — kalau tidak, karyawan
//      melihat "Bonus Rp500.000" untuk pekerjaan yang belum dikerjakan.
//   2. Nominal TIDAK BOLEH diubah kalau payroll bulan itu sudah LOCKED
//      (payslip sudah final; lihat lib/gaji.ts payrollLocked).
//   3. Setiap perubahan writes ke AuditLog dengan nilai SEBELUM — tanpa itu,
//      nominal lama hilang permanen karena kolomnya ditimpa.
//
// Kalau agenda adalah template master, nominal-nya dipropagasi ke turunan yang
// (a) belum punya nominal dan (b) SUDAH DIVERIFIKASI.

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
    const alasan =
      typeof body.alasan === "string" && body.alasan.trim().length > 0
        ? body.alasan.trim()
        : null;

    const agenda = await prisma.agenda.findUnique({
      where: { id },
      select: {
        id: true,
        judul: true,
        sumber: true,
        status: true,
        templateId: true,
        nominal: true,
        nominalSetAt: true,
        targetEmployeeId: true,
        // Tanggal acuan untuk cek payroll LOCKED.
        diselesaikanPada: true,
      },
    });

    if (!agenda) {
      return NextResponse.json(
        { error: "Agenda tidak ditemukan." },
        { status: 404 }
      );
    }

    // [1] Hanya agenda yang sudah diverifikasi boleh punya nominal.
    //
    // CARA MENDETEKSI TEMPLATE MASTER: lewat `targetEmployeeId === null`, BUKAN
    // lewat `templateId === null`. Alasannya: agenda MANDIRI_KARYAWAN juga punya
    // templateId = null (merekaself-report, bukan turunan), jadi memakai
    // templateId membuat agenda mandiri salah dikira template master — dan
    // perubahan nominal-nya ikut ter-propagate ke "turunan" yang tidak ada.
    // POST /api/agenda selalu membuat template dengan targetEmployeeId: null.
    const adalahTemplateMaster = agenda.targetEmployeeId === null;
    if (!adalahTemplateMaster && agenda.status !== "DIVERIFIKASI") {
      return NextResponse.json(
        {
          error: `Nominal hanya bisa diubah untuk agenda yang sudah diverifikasi. Status saat ini: ${agenda.status}.`,
        },
        { status: 409 }
      );
    }

    // [2] Guard payroll LOCKED untuk target yang punya.
    // Beberapa agenda tidak punya tanggal selesai (mis. belum dikerjakan) —
    // untuk kasus itu tidak ada periode payroll yang bisa dicek.
    if (agenda.targetEmployeeId && agenda.diselesaikanPada) {
      const terkunci = await payrollLocked(
        prisma,
        agenda.targetEmployeeId,
        agenda.diselesaikanPada
      );
      if (terkunci) {
        return NextResponse.json(
          { error: pesanPayrollLocked(agenda.diselesaikanPada) },
          { status: 409 }
        );
      }
    }

    const now = new Date();
    const hasil = await prisma.$transaction(async (tx) => {
      // Helper audit lokal — dipakai baik di kasus 1 maupun 2.
      const catatAudit = (
        recordId: string,
        sebelum: number | null,
        label: string
      ) =>
        tx.auditLog.create({
          data: {
            tabel: "Agenda",
            recordId,
            aksi: "UPDATE",
            nilaiSebelum: { nominal: sebelum },
            nilaiSesudah: { nominal },
            actorId: session.user.id,
            alasan: alasan ? `${label}: ${alasan}` : label,
          },
        });

      // Kasus 1: agenda turunan atau mandiri (punya target) — set langsung.
      if (!adalahTemplateMaster) {
        const updated = await tx.agenda.update({
          where: { id },
          data: { nominal, nominalSetById: session.user.id, nominalSetAt: now },
        });
        await catatAudit(id, agenda.nominal, "Set nominal bonus agenda");
        return { id: updated.id, propagatedCount: 0 };
      }

      // Kasus 2: template master — set + propagate.
      const master = await tx.agenda.update({
        where: { id },
        data: { nominal, nominalSetById: session.user.id, nominalSetAt: now },
      });
      await catatAudit(id, agenda.nominal, "Set nominal template agenda");

      // Hanya turunan yang SUDAH DIVERIFIKASI. Tanpa filter status ini,
      // turunan PENDING (belum dikerjakan) ikut dapat nominal.
      const kandidat = await tx.agenda.findMany({
        where: { templateId: id, nominal: null, status: "DIVERIFIKASI" },
        select: { id: true, nominal: true },
      });

      // Lewati turunan yang payroll-nya sudah LOCKED — nominalnya harus
      // konsisten dengan payslip yang sudah final.
      const bolehDiubah: typeof kandidat = [];
      for (const t of kandidat) {
        const turunan = await tx.agenda.findUnique({
          where: { id: t.id },
          select: {
            targetEmployeeId: true,
            diselesaikanPada: true,
          },
        });
        if (turunan?.targetEmployeeId && turunan.diselesaikanPada) {
          if (await payrollLocked(tx, turunan.targetEmployeeId, turunan.diselesaikanPada)) {
            continue;
          }
        }
        bolehDiubah.push(t);
      }

      let propagated = 0;
      if (bolehDiubah.length > 0) {
        const r = await tx.agenda.updateMany({
          where: { id: { in: bolehDiubah.map((t) => t.id) } },
          data: { nominal, nominalSetById: session.user.id, nominalSetAt: now },
        });
        propagated = r.count;
        // updateMany tidak bisa menulis audit per-row — lakukan manual.
        for (const t of bolehDiubah) {
          await catatAudit(t.id, t.nominal, "Propagate nominal dari template");
        }
      }

      return { id: master.id, propagatedCount: propagated, templateId: id };
    });

    return NextResponse.json({
      id: hasil.id,
      nominal,
      propagatedCount: hasil.propagatedCount,
    });
  } catch (err) {
    console.error("PATCH /api/agenda/[id]/nominal error:", err);
    return NextResponse.json(
      { error: "Gagal menetapkan nominal. Silakan coba lagi." },
      { status: 500 }
    );
  }
}
