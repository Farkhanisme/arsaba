import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];

type ShiftInput = {
  id?: string;
  nama: string;
  jamMulaiMenit: number;
  jamSelesaiMenit: number;
  lintasHari: boolean;
  aktif?: boolean;
};

function validateShiftInput(raw: unknown, index: number): { ok: true; value: ShiftInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: `shifts[${index}] harus object.` };
  }
  const r = raw as Record<string, unknown>;

  let id: string | undefined;
  if (r.id !== undefined) {
    if (typeof r.id !== "string" || r.id.length === 0) {
      return { ok: false, error: `shifts[${index}].id harus string non-empty.` };
    }
    id = r.id;
  }

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

  let aktif: boolean | undefined;
  if (r.aktif !== undefined) {
    if (typeof r.aktif !== "boolean") {
      return { ok: false, error: `shifts[${index}].aktif harus boolean.` };
    }
    aktif = r.aktif;
  }

  return { ok: true, value: { id, nama: nama.trim(), jamMulaiMenit, jamSelesaiMenit, lintasHari, aktif } };
}

type Body = {
  nama?: unknown;
  alias?: unknown;
  aktif?: unknown;
  pamEnabled?: unknown;
  shifts?: unknown;
};

// PATCH /api/store/[id] — update toko. Hanya ADMIN, SUPERVISOR, MANAJER.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Session tidak valid." }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang mengubah toko." },
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

    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Toko tidak ditemukan." },
        { status: 404 }
      );
    }

    const data: Record<string, unknown> = {};

    if (body.nama !== undefined) {
      if (typeof body.nama !== "string" || body.nama.trim().length < 2) {
        return NextResponse.json(
          { error: "Field 'nama' harus diisi, minimal 2 karakter." },
          { status: 400 }
        );
      }
      data.nama = body.nama.trim();
    }

    if (body.alias !== undefined) {
      if (body.alias === null || body.alias === "") {
        data.alias = null;
      } else if (typeof body.alias === "string") {
        data.alias = body.alias.trim();
      } else {
        return NextResponse.json(
          { error: "Field 'alias' harus string atau null." },
          { status: 400 }
        );
      }
    }

    if (body.aktif !== undefined) {
      if (typeof body.aktif !== "boolean") {
        return NextResponse.json(
          { error: "Field 'aktif' harus boolean." },
          { status: 400 }
        );
      }
      data.aktif = body.aktif;
    }

    if (body.pamEnabled !== undefined) {
      if (typeof body.pamEnabled !== "boolean") {
        return NextResponse.json(
          { error: "Field 'pamEnabled' harus boolean." },
          { status: 400 }
        );
      }
      data.pamEnabled = body.pamEnabled;
    }

    let shifts: ShiftInput[] | undefined;
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

    if (Object.keys(data).length === 0 && shifts === undefined) {
      return NextResponse.json(
        { error: "Tidak ada field yang diubah." },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      let store = existing;

      // Audit log entries to batch insert
      const auditEntries: Array<{
        tabel: string;
        recordId: string;
        aksi: string;
        nilaiSebelum?: any;
        nilaiSesudah?: any;
        actorId: string;
        alasan?: string;
      }> = [];

      // Update store data if provided
      if (Object.keys(data).length > 0) {
        // Fix Prisma proxy spread: explicit destructuring
        const { nama: oldNama, alias: oldAlias, aktif: oldAktif, pamEnabled: oldPam } = existing;
        store = await tx.store.update({ where: { id }, data });

        // Audit log: UPDATE_STORE
        auditEntries.push({
          tabel: "Store",
          recordId: store.id,
          aksi: "UPDATE",
          nilaiSebelum: { nama: oldNama, alias: oldAlias, aktif: oldAktif, pamEnabled: oldPam },
          nilaiSesudah: { nama: store.nama, alias: store.alias, aktif: store.aktif, pamEnabled: store.pamEnabled },
          actorId: session.user.id,
        });
      }

      if (shifts !== undefined) {
        const existingTemplates = await tx.shiftTemplate.findMany({
          where: { storeId: id },
          select: { id: true, nama: true, jamMulaiMenit: true, jamSelesaiMenit: true, lintasHari: true, aktif: true },
        });
        const existingById = new Map(existingTemplates.map((t) => [t.id, t]));

        const keepIds = new Set<string>();

        for (const s of shifts) {
          if (s.id && existingById.has(s.id)) {
            const oldShift = existingById.get(s.id)!;
            await tx.shiftTemplate.update({
              where: { id: s.id },
              data: {
                nama: s.nama,
                jamMulaiMenit: s.jamMulaiMenit,
                jamSelesaiMenit: s.jamSelesaiMenit,
                lintasHari: s.lintasHari,
                ...(s.aktif !== undefined ? { aktif: s.aktif } : {}),
              },
            });
            keepIds.add(s.id);

            // Audit log: UPDATE_SHIFT (batched)
            auditEntries.push({
              tabel: "ShiftTemplate",
              recordId: s.id,
              aksi: "UPDATE",
              nilaiSebelum: { nama: oldShift.nama, jamMulaiMenit: oldShift.jamMulaiMenit, jamSelesaiMenit: oldShift.jamSelesaiMenit, lintasHari: oldShift.lintasHari, aktif: oldShift.aktif },
              nilaiSesudah: { nama: s.nama, jamMulaiMenit: s.jamMulaiMenit, jamSelesaiMenit: s.jamSelesaiMenit, lintasHari: s.lintasHari, aktif: s.aktif ?? oldShift.aktif },
              actorId: session.user.id,
            });
          } else if (!s.id) {
            const created = await tx.shiftTemplate.create({
              data: {
                storeId: id,
                nama: s.nama,
                jamMulaiMenit: s.jamMulaiMenit,
                jamSelesaiMenit: s.jamSelesaiMenit,
                lintasHari: s.lintasHari,
                ...(s.aktif !== undefined ? { aktif: s.aktif } : {}),
              },
            });
            keepIds.add(created.id);

            // Audit log: CREATE_SHIFT (batched)
            auditEntries.push({
              tabel: "ShiftTemplate",
              recordId: created.id,
              aksi: "CREATE",
              nilaiSesudah: { nama: created.nama, jamMulaiMenit: created.jamMulaiMenit, jamSelesaiMenit: created.jamSelesaiMenit, lintasHari: created.lintasHari, aktif: created.aktif, storeId: id },
              actorId: session.user.id,
            });
          } else {
            throw new Error("IDOR_DETECTED");
          }
        }

        // Soft delete yang hilang dari array
        const toDeactivate = [...existingById.keys()].filter((eid) => !keepIds.has(eid));
        if (toDeactivate.length > 0) {
          await tx.shiftTemplate.updateMany({
            where: { id: { in: toDeactivate } },
            data: { aktif: false },
          });

          // Remove redundant query: use existingById Map instead of findMany
          for (const eid of toDeactivate) {
            const shift = existingById.get(eid);
            if (shift) {
              // Audit log: DEACTIVATE_SHIFT (batched)
              auditEntries.push({
                tabel: "ShiftTemplate",
                recordId: eid,
                aksi: "DELETE",
                nilaiSebelum: { nama: shift.nama, aktif: true },
                nilaiSesudah: { nama: shift.nama, aktif: false },
                actorId: session.user.id,
                alasan: "Soft delete via store shift update",
              });
            }
          }
        }
      }

      // Batch insert all audit logs at once
      if (auditEntries.length > 0) {
        await tx.auditLog.createMany({ data: auditEntries });
      }

      return store;
    });

    return NextResponse.json({
      id: updated.id,
      nama: updated.nama,
      alias: updated.alias,
      aktif: updated.aktif,
      pamEnabled: updated.pamEnabled,
      shiftsCount: shifts ? shifts.length : undefined,
    });
  } catch (err) {
    console.error("PATCH /api/store/[id] error:", err);
    if (err instanceof Error && err.message === "IDOR_DETECTED") {
      return NextResponse.json(
        { error: "Akses ditolak: Shift bukan milik toko ini." },
        { status: 403 }
      );
    }
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
      { error: "Gagal mengubah toko." },
      { status: 500 }
    );
  }
}
