// UJI REGRESI — RBAC & audit master data (lib/rbac.ts + /api/user)
// Jalankan: npx tsx --env-file=.env scripts/uji-rbac-http.ts
//
// Cakupan:
//   [1] bolehSetRole — matriks hierarki + pengecualian MANAJER <-> DIREKTUR.
//   [2] Hierarki: SUPERVISOR tidak bisa naik ke MANAJER/DIREKTUR (bug eskalasi P0-2).
//   [3] Guard self-patch: tidak bisa mengubah akun sendiri.
//   [4] Audit log tercatat untuk perubahan role/storeId/status.
//   [5] RiwayatPenempatan tertulis saat storeId berubah (tadinya 0 penulisan).
//   [6] PII tidak bocor ke payload AuditLog.
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { login, BASE } from "./http-test";
import { RANK, bolehSetRole } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIRBAC-${suffix}`;

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


async function patchUser(
  jar: string,
  id: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}/api/user/${id}`, {
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
    const jarMgr = await login("MGR-001", seedPass);
    if (!/session-token/i.test(jarMgr)) throw new Error("login MANAJER gagal");
    const jarSup = await login("EMP-002", seedPass);
    if (!/session-token/i.test(jarSup)) throw new Error("login SUPERVISOR gagal");

    // ================= [1] Matriks bolehSetRole =================
    console.log("\n[1] bolehSetRole — matriks hierarki");
    assert(RANK.DIREKTUR > RANK.MANAJER && RANK.MANAJER > RANK.SUPERVISOR, "urutan rank DIREKTUR > MANAJER > SUPERVISOR");
    assert(RANK.SUPERVISOR > RANK.ADMIN && RANK.ADMIN > RANK.KEPALA_TOKO, "urutan rank SUPERVISOR > ADMIN > KEPALA_TOKO");
    assert(RANK.KEPALA_TOKO > RANK.KARYAWAN, "urutan rank KEPALA_TOKO > KARYAWAN");

    assert(bolehSetRole("SUPERVISOR", "MANAJER") === false, "SUPERVISOR -> MANAJER: DITOLAK (anti-eskalasi)");
    assert(bolehSetRole("SUPERVISOR", "DIREKTUR") === false, "SUPERVISOR -> DIREKTUR: DITOLAK");
    assert(bolehSetRole("SUPERVISOR", "ADMIN") === true, "SUPERVISOR -> ADMIN: boleh");
    assert(bolehSetRole("SUPERVISOR", "KARYAWAN") === true, "SUPERVISOR -> KARYAWAN: boleh");
    assert(bolehSetRole("SUPERVISOR", "SUPERVISOR") === false, "SUPERVISOR -> SUPERVISOR: DITOLAK (tak bisa sam elevate)");
    assert(bolehSetRole("MANAJER", "SUPERVISOR") === true, "MANAJER -> SUPERVISOR: boleh");
    assert(bolehSetRole("MANAJER", "DIREKTUR") === true, "MANAJER -> DIREKTUR: BOLEH (pengecualian K3)");
    assert(bolehSetRole("DIREKTUR", "MANAJER") === true, "DIREKTUR -> MANAJER: BOLEH (pengecualian K3)");
    assert(bolehSetRole("DIREKTUR", "DIREKTUR") === false, "DIREKTUR -> DIREKTUR: DITOLAK");
    assert(bolehSetRole("KARYAWAN", "ADMIN") === false, "KARYAWAN -> ADMIN: DITOLAK");

    // ================= [2] Eskalasi via API =================
    console.log("\n[2] Hierarki ditegakkan server (bug P0-2)");
    // Buat user uji bertingkat: KARYAWAN, ADMIN, SUPERVISOR.
    const mk = async (kode: string, role: Role, storeId: string | null) =>
      prisma.user.create({
        data: { kode, nama: `Uji ${kode}`, role, status: "AKTIF", storeId },
      });
    const kar = await mk(`${PREFIX}-KAR`, "KARYAWAN", null);
    const admin = await mk(`${PREFIX}-ADM`, "ADMIN", null);

    let r = await patchUser(jarSup, kar.id, { role: "MANAJER" });
    assert(r.status === 403, "SUPERVISOR_patch KARYAWAN jadi MANAJER → 403", r);
    r = await patchUser(jarSup, admin.id, { role: "DIREKTUR" });
    assert(r.status === 403, "SUPERVISOR_patch ADMIN jadi DIREKTUR → 403", r);
    r = await patchUser(jarSup, kar.id, { role: "KEPALA_TOKO" });
    assert(r.status === 200, "SUPERVISOR_patch KARYAWAN jadi KEPALA_TOKO → 200 (di bawah dia)", r);

    r = await patchUser(jarMgr, admin.id, { role: "DIREKTUR" });
    assert(r.status === 200, "MANAJER_patch ADMIN jadi DIREKTUR → 200 (pengecualian)", r);
    // kembalikan
    await patchUser(jarMgr, admin.id, { role: "ADMIN" });

    // ================= [3] Guard self-patch =================
    console.log("\n[3] Guard self-patch (jalur eskalasi tersembunyi)");
    // Harus patch AKUN YANG SEDANG LOGIN (EMP-002), bukan user uji — kalau
    // pakai user uji, guard `id === session.user.id` tidak akan tersentuh.
    const loginSup = await prisma.user.findUnique({
      where: { kode: "EMP-002" },
      select: { id: true, role: true },
    });
    assert(Boolean(loginSup), "user EMP-002 (supervisor uji login) ditemukan");
    r = await patchUser(jarSup, loginSup!.id, { role: "MANAJER" });
    assert(r.status === 400, "SUPERVISOR_patch akun SENDIRI → 400", r);

    const diriDiaSendiri = await prisma.user.findUnique({
      where: { id: loginSup!.id },
      select: { role: true },
    });
    assert(
      diriDiaSendiri?.role === loginSup!.role,
      "role akun yang login tidak berubah setelah self-patch",
      diriDiaSendiri
    );

    // ================= [4] Audit log =================
    console.log("\n[4] Audit log tercatat");
    const audit = await prisma.auditLog.findMany({
      where: { recordId: kar.id, tabel: "User" },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length >= 1, `AuditLog User tercatat (${audit.length} baris)`, audit.length);
    const row = audit[0] as unknown as { nilaiSebelum: Record<string, unknown>; nilaiSesudah: Record<string, unknown> } | undefined;
    assert(
      Boolean(row && row.nilaiSebelum && "role" in row.nilaiSebelum),
      "nilaiSebelum memuat role lama",
      row?.nilaiSebelum
    );
    assert(
      Boolean(row && row.nilaiSesudah && "role" in row.nilaiSesudah),
      "nilaiSesudah memuat role baru",
      row?.nilaiSesudah
    );

    // ================= [5] RiwayatPenempatan =================
    console.log("\n[5] RiwayatPenempatan saat storeId berubah");
    const tokoA = await prisma.store.create({ data: { nama: `${PREFIX}-TOKOA` } });
    const tokoB = await prisma.store.create({ data: { nama: `${PREFIX}-TOKOB` } });
    await prisma.user.update({ where: { id: kar.id }, data: { storeId: tokoA.id } });

    const sebelum = await prisma.riwayatPenempatan.count({ where: { employeeId: kar.id } });
    r = await patchUser(jarMgr, kar.id, { storeId: tokoB.id, alasan: "Mutasi uji" });
    assert(r.status === 200, "PATCH storeId → 200", r);
    const sesudah = await prisma.riwayatPenempatan.findMany({ where: { employeeId: kar.id } });
    assert(sesudah.length === sebelum + 1, `RiwayatPenempatan bertambah (${sebelum} -> ${sesudah.length})`);
    const rp = sesudah[sesudah.length - 1];
    assert(rp?.dariTokoId === tokoA.id, "dariTokoId = toko lama", rp?.dariTokoId);
    assert(rp?.keTokoId === tokoB.id, "keTokoId = toko baru", rp?.keTokoId);
    assert(rp?.alasan === "Mutasi uji", "alasan tersimpan", rp?.alasan);

    // ================= [6] PII tidak bocor ke audit =================
    console.log("\n[6] PII tidak ditulis ke AuditLog");
    // NIK harus unik — pakai angka acak agar tidak bentrok dengan data seed.
    const nikUji = `99${suffix.slice(-8)}0000001`;
    r = await patchUser(jarMgr, kar.id, { nik: nikUji, nama: "Uji Ganti Nama" });
    assert(r.status === 200, "PATCH PII + nama → 200", r);
    const auditPii = await prisma.auditLog.findMany({
      where: { recordId: kar.id, tabel: "User" },
      orderBy: { createdAt: "desc" },
    });
    const auditJson = JSON.stringify(auditPii);
    assert(!auditJson.includes(nikUji), "NIK tidak muncul di payload AuditLog");
    assert(
      auditJson.includes("_piiDiubah"),
      "ada penanda _piiDiubah bahwa field PII berubah (tanpa nilainya)"
    );
    assert(
      auditJson.includes("Uji Ganti Nama"),
      "nama (non-PII) tetap tercatat di audit"
    );
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
        (await prisma.user.count({ where: { kode: { contains: "UJIRBAC" } } })) +
        (await prisma.store.count({ where: { nama: { contains: "UJIRBAC" } } }));
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
