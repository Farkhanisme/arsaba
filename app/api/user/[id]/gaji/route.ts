import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role, TipePerhitunganGaji } from "@prisma/client";
import { Prisma } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const TARGET_ROLES: Role[] = ["SUPERVISOR", "ADMIN", "KEPALA_TOKO", "KARYAWAN"];
const TIPE_VALUES: TipePerhitunganGaji[] = ["HARIAN", "BULANAN", "JAM"];
const NOMINAL_MAX = 100_000_000; // 100 juta

type Body = {
  tipePerhitunganGaji?: unknown;
  tarifPerJam?: unknown;
  nominalGajiPokok?: unknown;
};

// PATCH /api/user/[id]/gaji — set/update gaji user. Hanya MANAJER.
// Body: { tipePerhitunganGaji: "HARIAN"|"BULANAN"|"JAM", tarifPerJam?: number|null, nominalGajiPokok?: number }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Hanya Manajer yang berwenang mengelola gaji." },
        { status: 403 }
      );
    }

    const { id } = await params;

    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Tidak bisa mengubah gaji Anda sendiri." },
        { status: 400 }
      );
    }

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        nama: true,
        kode: true,
        role: true,
        tipePerhitunganGaji: true,
        tarifPerJam: true,
        gajiPokok: { select: { nominal: true } },
      },
    });
    if (!target) {
      return NextResponse.json(
        { error: "User tidak ditemukan." },
        { status: 404 }
      );
    }

    if (!TARGET_ROLES.includes(target.role)) {
      return NextResponse.json(
        {
          error:
            "Target tidak bisa diatur gajinya. Hanya supervisor ke bawah yang bisa di-set gaji.",
        },
        { status: 403 }
      );
    }

    // Validasi tipePerhitunganGaji
    const tipeRaw = body.tipePerhitunganGaji;
    if (
      typeof tipeRaw !== "string" ||
      !TIPE_VALUES.includes(tipeRaw as TipePerhitunganGaji)
    ) {
      return NextResponse.json(
        {
          error:
            "Field 'tipePerhitunganGaji' wajib diisi dengan HARIAN, BULANAN, atau JAM.",
        },
        { status: 400 }
      );
    }
    const tipe = tipeRaw as TipePerhitunganGaji;

    // Validasi tarifPerJam (nullable)
    let tarifPerJam: number | null = null;
    if (body.tarifPerJam !== undefined && body.tarifPerJam !== null) {
      const v = body.tarifPerJam;
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > NOMINAL_MAX
      ) {
        return NextResponse.json(
          { error: `Field 'tarifPerJam' harus integer 0-${NOMINAL_MAX}.` },
          { status: 400 }
        );
      }
      tarifPerJam = v;
    }

    // Konsistensi: tipe JAM wajib ada tarifPerJam; tipe lain tarifPerJam boleh null
    if (tipe === "JAM" && tarifPerJam === null) {
      return NextResponse.json(
        { error: "Tipe 'JAM' wajib menyertakan 'tarifPerJam'." },
        { status: 400 }
      );
    }
    if (tipe !== "JAM") {
      tarifPerJam = null;
    }

    // Validasi nominalGajiPokok (opsional; kalau diisi, akan upsert GajiPokok)
    let nominalGajiPokok: number | null = null;
    if (
      body.nominalGajiPokok !== undefined &&
      body.nominalGajiPokok !== null
    ) {
      const v = body.nominalGajiPokok;
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > NOMINAL_MAX
      ) {
        return NextResponse.json(
          { error: `Field 'nominalGajiPokok' harus integer 0-${NOMINAL_MAX}.` },
          { status: 400 }
        );
      }
      nominalGajiPokok = v;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Capture nilai sebelum untuk User
      const userBefore = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          tipePerhitunganGaji: true,
          tarifPerJam: true,
        },
      });

      // Capture nilai sebelum untuk GajiPokok
      const gajiPokokBefore = await tx.gajiPokok.findUnique({
        where: { employeeId: id },
        select: { nominal: true },
      });

      // Update User
      await tx.user.update({
        where: { id },
        data: {
          tipePerhitunganGaji: tipe,
          tarifPerJam,
        },
      });

      // Audit log for User UPDATE
      await tx.auditLog.create({
        data: {
          tabel: "User",
          recordId: id,
          aksi: "UPDATE",
          nilaiSebelum: userBefore
            ? {
                id: userBefore.id,
                tipePerhitunganGaji: userBefore.tipePerhitunganGaji,
                tarifPerJam: userBefore.tarifPerJam,
              }
            : Prisma.JsonNull,
          nilaiSesudah: {
            id,
            tipePerhitunganGaji: tipe,
            tarifPerJam,
          },
          actorId: session.user.id,
        },
      });

      // Upsert GajiPokok if nominal provided
      let gajiPokokAfter: { nominal: number } | null = null;
      if (nominalGajiPokok !== null) {
        const upserted = await tx.gajiPokok.upsert({
          where: { employeeId: id },
          create: { employeeId: id, nominal: nominalGajiPokok },
          update: { nominal: nominalGajiPokok },
          select: { nominal: true },
        });
        gajiPokokAfter = upserted;

        // Audit log for GajiPokok CREATE/UPDATE
        await tx.auditLog.create({
          data: {
            tabel: "GajiPokok",
            recordId: id, // employeeId is the unique key
            aksi: gajiPokokBefore ? "UPDATE" : "CREATE",
            nilaiSebelum: gajiPokokBefore ? { nominal: gajiPokokBefore.nominal } : Prisma.JsonNull,
            nilaiSesudah: { nominal: nominalGajiPokok },
            actorId: session.user.id,
          },
        });
      }

      return tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          kode: true,
          nama: true,
          tipePerhitunganGaji: true,
          tarifPerJam: true,
          gajiPokok: { select: { nominal: true } },
        },
      });
    });

    if (!result) {
      return NextResponse.json(
        { error: "Gagal memuat hasil setelah update." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: result.id,
      kode: result.kode,
      nama: result.nama,
      tipePerhitunganGaji: result.tipePerhitunganGaji,
      tarifPerJam: result.tarifPerJam,
      nominalGajiPokok: result.gajiPokok?.nominal ?? null,
    });
  } catch (err) {
    console.error("PATCH /api/user/[id]/gaji error:", err);
    return NextResponse.json(
      { error: "Gagal mengubah gaji." },
      { status: 500 }
    );
  }
}
