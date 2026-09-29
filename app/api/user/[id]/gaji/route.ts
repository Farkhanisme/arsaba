import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validasiTarif, NOMINAL_MAX } from "@/lib/gaji";
import { NextRequest, NextResponse } from "next/server";
import type { Role, TipePerhitunganGaji } from "@prisma/client";
import { Prisma } from "@prisma/client";

const ALLOWED_ROLES: Role[] = ["MANAJER"];
const TARGET_ROLES: Role[] = ["SUPERVISOR", "ADMIN", "KEPALA_TOKO", "KARYAWAN"];
const TIPE_VALUES: TipePerhitunganGaji[] = ["HARIAN", "BULANAN", "JAM"];

type Body = {
  tipePerhitunganGaji?: unknown;
  tarifPerJam?: unknown;
  tarifPerHari?: unknown;
  nominalGajiPokok?: unknown;
};

// PATCH /api/user/[id]/gaji — set/update gaji user. Hanya MANAJER.
//
// Setiap tipe punya tarif WAJIB-nya sendiri (lihat lib/gaji.ts validasiTarif):
//   JAM     → tarifPerJam       (wajib)
//   HARIAN  → tarifPerHari      (wajib)  ← tarif harian, BUKAN tarifPerJam x 8
//   BULANAN → nominalGajiPokok  (wajib, boleh pakai nilai existing)
//
// Field yang tidak relevan untuk tipe aktif dinormalkan ke null, dan field yang
// relevan WAJIB ada. Aturan inilah yang mencegah regresi P0-1: sebelumnya
// tarifPerJam di-null-kan untuk tipe non-JAM tanpa ada pengganti untuk HARIAN,
// sehingga baseGaji selalu Rp 0.

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

    // Validasi tarifPerHari (nullable) — dipakai tipe HARIAN (§7.1).
    // PENTING: tarif harian TIDAK boleh diturunkan dari tarifPerJam × 8,
    // karena jam kerja berbeda per toko.
    let tarifPerHari: number | null = null;
    if (body.tarifPerHari !== undefined && body.tarifPerHari !== null) {
      const v = body.tarifPerHari;
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > NOMINAL_MAX
      ) {
        return NextResponse.json(
          { error: `Field 'tarifPerHari' harus integer 0-${NOMINAL_MAX}.` },
          { status: 400 }
        );
      }
      tarifPerHari = v;
    }

    // Validasi nominalGajiPokok (hanya relevan untuk tipe BULANAN)
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

    // Normalisasi: field yang tidak relevan untuk tipe aktif dinormalkan ke null
    // (supaya tidak ada data menetu yang diam-diam dipakai) — TAPI field yang
    // WAJIB untuk tipe aktif harus ada. Aturan ini yang mencegah bug P0-1:
    // dulu tarifPerJam di-null-kan tanpa ada pengganti untuk tipe HARIAN,
    // sehingga baseGaji selalu 0.
    if (tipe !== "JAM") tarifPerJam = null;
    if (tipe !== "HARIAN") tarifPerHari = null;
    if (tipe !== "BULANAN") nominalGajiPokok = null;

    // Gaji pokok existing dipakai sebagai fallback untuk tipe BULANAN, supaya
    // form tidak wajib diisi ulang setiap kali menyimpan.
    const gajiPokokExisting = target.gajiPokok?.nominal ?? null;
    const nilaiGajiPokok = nominalGajiPokok ?? gajiPokokExisting;

    const pesanTarif = validasiTarif(tipe, {
      tarifPerJam,
      tarifPerHari,
      gajiPokokNominal: nilaiGajiPokok,
    });
    if (pesanTarif) {
      return NextResponse.json({ error: pesanTarif }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Capture nilai sebelum untuk User
      const userBefore = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          tipePerhitunganGaji: true,
          tarifPerJam: true,
          tarifPerHari: true,
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
          tarifPerHari,
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
                tarifPerHari: userBefore.tarifPerHari,
              }
            : Prisma.JsonNull,
          nilaiSesudah: {
            id,
            tipePerhitunganGaji: tipe,
            tarifPerJam,
            tarifPerHari,
          },
          actorId: session.user.id,
        },
      });

      // Upsert GajiPokok if nominal provided
      if (nominalGajiPokok !== null) {
        await tx.gajiPokok.upsert({
          where: { employeeId: id },
          create: { employeeId: id, nominal: nominalGajiPokok },
          update: { nominal: nominalGajiPokok },
          select: { nominal: true },
        });

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
          tarifPerHari: true,
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
      tarifPerHari: result.tarifPerHari,
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
