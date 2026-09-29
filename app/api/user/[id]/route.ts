import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bolehSetRole, PESAN_TIDAK_BERWENANG_ROLE } from "@/lib/rbac";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["ADMIN", "SUPERVISOR", "MANAJER"];
const ASSIGNABLE_ROLES: Role[] = [
  "KARYAWAN",
  "KEPALA_TOKO",
  "SUPERVISOR",
  "ADMIN",
  "MANAJER",
  "DIREKTUR",
];

type Body = {
  nama?: unknown;
  role?: unknown;
  storeId?: unknown;
  status?: unknown;
  tanggalMasuk?: unknown;
  nik?: unknown;
  tempatLahir?: unknown;
  tanggalLahir?: unknown;
  alamat?: unknown;
  kontakDarurat?: unknown;
  bolehAbsenTanpaShift?: unknown;
  /** Alasan perubahan — opsional, disimpan di AuditLog & RiwayatPenempatan. */
  alasan?: unknown;
};

// PATCH /api/user/[id] — update user (non-gaji).
// Field gaji (tipePerhitunganGaji, tarifPerJam) di endpoint terpisah (C-6, MANAJER only).
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
        { error: "Role Anda tidak berwenang mengubah user." },
        { status: 403 }
      );
    }

    const { id } = await params;

    // Guard self-patch. Tanpa ini, SUPERVISOR bisa PATCH akunnya sendiri dengan
    // { role: "MANAJER" } lalu langsung mendapat akses ke /manajer/gaji,
    // /api/payroll/*, dan user/[id]/gaji. Route sequesta yang sudah punya guard
    // ini: reset-password/route.ts dan [id]/gaji/route.ts.
    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Tidak bisa mengubah data akun sendiri dari halaman ini." },
        { status: 400 }
      );
    }

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "User tidak ditemukan." },
        { status: 404 }
      );
    }

    // Hierarki: actor tidak boleh menyentuh akun dengan role setinggi/lebih tinggi
    // darinya. Exception MANAJER <-> DIREKTUR ditangani di bolehSetRole().
    const actorRole = session.user.role;
    if (!bolehSetRole(actorRole, existing.role)) {
      return NextResponse.json(
        {
          error: "Tidak berwenang mengubah akun dengan role di atas atau sama dengan level Anda.",
        },
        { status: 403 }
      );
    }

    const data: Record<string, unknown> = {};

    if (body.nama !== undefined) {
      if (typeof body.nama !== "string" || body.nama.trim().length < 2) {
        return NextResponse.json(
          { error: "Field 'nama' minimal 2 karakter." },
          { status: 400 }
        );
      }
      data.nama = body.nama.trim();
    }

    if (body.role !== undefined) {
      if (
        typeof body.role !== "string" ||
        !ASSIGNABLE_ROLES.includes(body.role as Role)
      ) {
        return NextResponse.json(
          { error: "Field 'role' tidak valid." },
          { status: 400 }
        );
      }
      // Hierarki: actor hanya boleh menetapkan role di bawah dirinya.
      if (!bolehSetRole(actorRole, body.role as Role)) {
        return NextResponse.json(
          { error: PESAN_TIDAK_BERWENANG_ROLE },
          { status: 403 }
        );
      }
      data.role = body.role;
    }

    if (body.storeId !== undefined) {
      if (body.storeId === null || body.storeId === "") {
        data.storeId = null;
      } else if (typeof body.storeId === "string") {
        const store = await prisma.store.findUnique({
          where: { id: body.storeId },
        });
        if (!store) {
          return NextResponse.json(
            { error: "Toko tidak ditemukan." },
            { status: 404 }
          );
        }
        data.storeId = body.storeId;
      } else {
        return NextResponse.json(
          { error: "Field 'storeId' harus string atau null." },
          { status: 400 }
        );
      }
    }

    if (body.status !== undefined) {
      if (
        body.status !== "AKTIF" &&
        body.status !== "RESIGN" &&
        body.status !== "NONAKTIF"
      ) {
        return NextResponse.json(
          { error: "Field 'status' tidak valid." },
          { status: 400 }
        );
      }
      data.status = body.status;
    }

    if (body.tanggalMasuk !== undefined) {
      if (body.tanggalMasuk === null || body.tanggalMasuk === "") {
        data.tanggalMasuk = null;
      } else if (typeof body.tanggalMasuk === "string") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.tanggalMasuk);
        if (!m) {
          return NextResponse.json(
            { error: "Field 'tanggalMasuk' harus format YYYY-MM-DD." },
            { status: 400 }
          );
        }
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const parsed = new Date(Date.UTC(y, mo - 1, d));
        if (
          parsed.getUTCFullYear() !== y ||
          parsed.getUTCMonth() !== mo - 1 ||
          parsed.getUTCDate() !== d
        ) {
          return NextResponse.json(
            { error: "Field 'tanggalMasuk' bukan tanggal valid." },
            { status: 400 }
          );
        }
        data.tanggalMasuk = parsed;
      } else {
        return NextResponse.json(
          { error: "Field 'tanggalMasuk' harus string atau null." },
          { status: 400 }
        );
      }
    }

    // Gate absensi tanpa shift: boleh check-in walau tidak punya
    // ShiftInstance APPROVED pada tanggal check-in.
    if (body.bolehAbsenTanpaShift !== undefined) {
      if (typeof body.bolehAbsenTanpaShift !== "boolean") {
        return NextResponse.json(
          { error: "Field 'bolehAbsenTanpaShift' harus boolean." },
          { status: 400 }
        );
      }
      data.bolehAbsenTanpaShift = body.bolehAbsenTanpaShift;
    }

    // PII fields — terima string atau null
    const piiFields = ["nik", "tempatLahir", "alamat", "kontakDarurat"] as const;
    for (const f of piiFields) {
      if (body[f] !== undefined) {
        if (body[f] === null || body[f] === "") {
          data[f] = null;
        } else if (typeof body[f] === "string") {
          data[f] = (body[f] as string).trim();
        } else {
          return NextResponse.json(
            { error: `Field '${f}' harus string atau null.` },
            { status: 400 }
          );
        }
      }
    }

    if (body.tanggalLahir !== undefined) {
      if (body.tanggalLahir === null || body.tanggalLahir === "") {
        data.tanggalLahir = null;
      } else if (typeof body.tanggalLahir === "string") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.tanggalLahir);
        if (!m) {
          return NextResponse.json(
            { error: "Field 'tanggalLahir' harus format YYYY-MM-DD." },
            { status: 400 }
          );
        }
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const parsed = new Date(Date.UTC(y, mo - 1, d));
        if (
          parsed.getUTCFullYear() !== y ||
          parsed.getUTCMonth() !== mo - 1 ||
          parsed.getUTCDate() !== d
        ) {
          return NextResponse.json(
            { error: "Field 'tanggalLahir' bukan tanggal valid." },
            { status: 400 }
          );
        }
        data.tanggalLahir = parsed;
      } else {
        return NextResponse.json(
          { error: "Field 'tanggalLahir' harus string atau null." },
          { status: 400 }
        );
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Tidak ada field yang diubah." },
        { status: 400 }
      );
    }

    // Fields yang benar-benar berubah — hanya ini yang masuk AuditLog.
    // Field PII sengaja TIDAK ikut: jangan salin NIK/alamat ke audit log.
    const JEJAK_PII = new Set([
      "nik",
      "tempatLahir",
      "tanggalLahir",
      "alamat",
      "kontakDarurat",
    ]);
    const berubah = Object.keys(data).filter((k) => !JEJAK_PII.has(k));
    const nilaiSebelum: Record<string, unknown> = {};
    const nilaiSesudah: Record<string, unknown> = {};
    for (const k of berubah) {
      nilaiSebelum[k] = (existing as unknown as Record<string, unknown>)[k] ?? null;
      nilaiSesudah[k] = data[k] ?? null;
    }
    // Tandai PII yang berubah tanpa menyimpan isinya.
    const piiBerubah = Object.keys(data).filter((k) => JEJAK_PII.has(k));

    const storeBerpindah =
      "storeId" in data && (data.storeId ?? null) !== (existing.storeId ?? null);
    const alasan = typeof body.alasan === "string" ? body.alasan.trim() : null;

    const updated = await prisma.$transaction(async (tx) => {
      const hasil = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          kode: true,
          nama: true,
          role: true,
          status: true,
          storeId: true,
          tanggalMasuk: true,
          bolehAbsenTanpaShift: true,
        },
      });

      // Audit log — wajib untuk perubahan master data (spesifikasi §8:415).
      if (berubah.length > 0 || piiBerubah.length > 0) {
        await tx.auditLog.create({
          data: {
            tabel: "User",
            recordId: id,
            aksi: "UPDATE",
            nilaiSebelum: { id, ...nilaiSebelum },
            nilaiSesudah: {
              id,
              ...nilaiSesudah,
              ...(piiBerubah.length > 0
                ? { _piiDiubah: piiBerubah }
                : {}),
            },
            actorId: session.user.id,
            alasan,
          },
        });
      }

      // Riwayat penempatan — Karyawan yang pindah toko tidak boleh dihapus
      // (§8:416): histori harus tetap utuh supaya data gaji/absensi/laporan
      // untuk toko lama bisa ditelusuri. Tabel ini sudah ada di skema tapi
      // tadinya HANYA ditulis dari seed — tidak ada satupun penulisan dari API.
      if (storeBerpindah) {
        const keTokoId = (data.storeId as string | null) ?? null;
        if (keTokoId) {
          await tx.riwayatPenempatan.create({
            data: {
              employeeId: id,
              dariTokoId: existing.storeId ?? null,
              keTokoId,
              alasan,
            },
          });
        }
      }

      return hasil;
    });

    return NextResponse.json({
      id: updated.id,
      kode: updated.kode,
      nama: updated.nama,
      role: updated.role,
      status: updated.status,
      storeId: updated.storeId,
      tanggalMasuk: updated.tanggalMasuk
        ? updated.tanggalMasuk.toISOString()
        : null,
      bolehAbsenTanpaShift: updated.bolehAbsenTanpaShift,
    });
  } catch (err) {
    console.error("PATCH /api/user/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal mengubah user." },
      { status: 500 }
    );
  }
}
