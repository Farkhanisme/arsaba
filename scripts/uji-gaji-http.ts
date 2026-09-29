// scripts/uji-gaji-http.ts
// Uji E2E PATCH /api/user/[id]/gaji lewat HTTP — membuktikan validasi tarif
// benar-benar ditegakkan SERVER (bukan hanya logika helper yang diuji
// scripts/uji-gaji.ts).
//
// Dijalankan: npm run dev (terminal lain), lalu npx tsx --env-file=.env scripts/uji-gaji-http.ts
//
// Restoran: tidak mengubah data produksi. Karyawan uji dibuat & dihapus sendiri.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { login, BASE } from "./http-test";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIGAJIHTTP-${suffix}`;

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${label}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`);
  }
}


async function patchGaji(
  jar: string,
  id: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}/api/user/${id}/gaji`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: jar },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function main() {
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!seedPass) {
    console.error("❌ SEED_PASSWORD / SEED_ADMIN_PASSWORD belum di-set.");
    process.exitCode = 1;
    return;
  }

  try {
    await tungguDB(prismaRaw);
    const jar = await login("MGR-001", seedPass);
    if (!/session-token/i.test(jar)) throw new Error("login MANAJER gagal");

    const store = await prisma.store.create({ data: { nama: `${PREFIX}-TOKO` } });
    const bcrypt = (await import("bcryptjs")).default;
    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`,
        nama: "Karyawan Uji Gaji HTTP",
        // Password dibuat supaya bisa menguji guard RBAC dari sisi karyawan.
        hashedPassword: await bcrypt.hash("UjiGajiHttp2026!", 10),
        role: "KARYAWAN",
        status: "AKTIF",
        storeId: store.id,
      },
    });

    console.log("\n[1] HARIAN wajib menyertakan tarifPerHari");
    let r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "HARIAN" });
    assert(r.status === 400, "HARIAN tanpa tarifPerHari → 400", r);
    assert(
      String(r.body?.error ?? "").includes("tarifPerHari"),
      "pesan error menyebut tarifPerHari",
      r.body
    );

    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "HARIAN", tarifPerHari: 120_000 });
    assert(r.status === 200, "HARIAN dengan tarifPerHari → 200", r);
    assert(r.body?.tarifPerHari === 120_000, "response echoes tarifPerHari", r.body);
    assert(r.body?.tarifPerJam === null, "response: tarifPerJam dinormalkan null", r.body);

    console.log("\n[2] JAM wajib menyertakan tarifPerJam");
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "JAM" });
    assert(r.status === 400, "JAM tanpa tarifPerJam → 400", r);
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "JAM", tarifPerJam: 5000 });
    assert(r.status === 200 && r.body?.tarifPerJam === 5000, "JAM dengan tarifPerJam → 200", r);

    console.log("\n[3] BULANAN wajib menyertakan nominalGajiPokok");
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "BULANAN" });
    assert(r.status === 400, "BULANAN tanpa nominalGajiPokok → 400", r);
    r = await patchGaji(jar, kar.id, {
      tipePerhitunganGaji: "BULANAN",
      nominalGajiPokok: 3_500_000,
    });
    assert(r.status === 200, "BULANAN dengan nominal → 200", r);

    console.log("\n[4] Nilai tidak valid ditolak");
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "HARIAN", tarifPerHari: -1 });
    assert(r.status === 400, "tarifPerHari negatif → 400", r);
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "HARIAN", tarifPerHari: 12.5 });
    assert(r.status === 400, "tarifPerHari desimal → 400", r);
    r = await patchGaji(jar, kar.id, {
      tipePerhitunganGaji: "HARIAN",
      tarifPerHari: 999_999_999,
    });
    assert(r.status === 400, "tarifPerHari > batas → 400", r);
    r = await patchGaji(jar, kar.id, { tipePerhitunganGaji: "NGAWUR" });
    assert(r.status === 400, "tipe tidak valid → 400", r);

    console.log("\n[5] Audit log tercatat");
    const audit = await prisma.auditLog.findMany({
      where: { recordId: kar.id, tabel: "User" },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length >= 3, `AuditLog User tercatat (${audit.length} baris)`, audit.length);
    const terakhir = audit[audit.length - 1] as unknown as {
      nilaiSebelum: unknown;
      nilaiSesudah: unknown;
    } | undefined;
    assert(
      Boolean(terakhir && "tarifPerHari" in (terakhir.nilaiSesudah as object)),
      "nilaiSesudah memuat tarifPerHari"
    );

    console.log("\n[6] RBAC: hanya MANAJER");
    const tanpaAuth = await fetch(`${BASE}/api/user/${kar.id}/gaji`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipePerhitunganGaji: "HARIAN", tarifPerHari: 1 }),
    });
    assert(tanpaAuth.status === 401, "tanpa auth → 401", tanpaAuth.status);

    const jarKar = await login(`${PREFIX}-KAR`, "UjiGajiHttp2026!");
    if (/session-token/i.test(jarKar)) {
      const karPatch = await patchGaji(jarKar, kar.id, {
        tipePerhitunganGaji: "JAM",
        tarifPerJam: 99_999,
      });
      assert(karPatch.status === 403, "KARYAWAN patch gaji → 403", karPatch);

      // Karyawan tidak boleh mengubah ke tipe valid pun — guard-nya role, bukan isi body.
      const karPatchValid = await patchGaji(jarKar, kar.id, {
        tipePerhitunganGaji: "HARIAN",
        tarifPerHari: 120_000,
      });
      assert(karPatchValid.status === 403, "KARYAWAN dengan body valid tetap 403", karPatchValid);
    } else {
      console.log("  ⓘ login KARYAWAN gagal — cek password uji di baris create user");
    }
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[7] Cleanup");
    try {
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } },
        select: { id: true },
      });
      for (const x of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: x.id } });
        await prisma.agenda.deleteMany({ where: { targetEmployeeId: x.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: x.id } });
        await prisma.attendance.deleteMany({ where: { employeeId: x.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: x.id } });
        await prisma.user.delete({ where: { id: x.id } });
      }
      await prisma.store.deleteMany({ where: { nama: { contains: PREFIX } } });
      const residu =
        (await prisma.user.count({ where: { kode: { contains: "UJIGAJIHTTP" } } })) +
        (await prisma.store.count({ where: { nama: { contains: "UJIGAJIHTTP" } } }));
      assert(residu === 0, `residu data uji = ${residu}`);
    } catch (e) {
      console.error("  ❌ Cleanup gagal:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

void main();
