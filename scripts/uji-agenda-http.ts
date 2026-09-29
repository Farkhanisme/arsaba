// UJI REGRESI — Nominal bonus agenda (PATCH /api/agenda/[id]/nominal
//                        & POST /api/agenda/nominal-batch)
//
// Cakupan:
//   [1] Guard status: hanya agenda DIVERIFIKASI boleh punya nominal.
//   [2] Audit log tercatat per perubahan, dengan nilai SEBELUM.
//   [3] Guard payroll LOCKED -> 409, dan data tidak berubah.
//   [4] Propagate dari template hanya ke turunan DIVERIFIKASI.
//   [5] Batch: preview tidak mengubah apa pun; commit menulis audit per record.
//
// Butuh: npm run dev berjalan di terminal lain.

import { prisma as prismaRaw } from "@/lib/prisma";
import { dbClient, tungguDB } from "./db-retry";
import { login, BASE } from "./http-test";
import { periodeDariTanggalShift } from "@/lib/gaji";

const prisma = dbClient(prismaRaw);
const suffix = Date.now().toString(36).toUpperCase();
const PREFIX = `UJIAGENDA-${suffix}`;

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


async function setNominal(
  jar: string,
  id: string,
  nominal: number,
  alasan?: string
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}/api/agenda/${id}/nominal`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: jar },
    body: JSON.stringify(alasan ? { nominal, alasan } : { nominal }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function batchNominal(
  jar: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}/api/agenda/nominal-batch`, {
    method: "POST",
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

    // Fixture: 1 karyawan target + agenda dengan berbagai status.
    const kar = await prisma.user.create({
      data: {
        kode: `${PREFIX}-KAR`,
        nama: "Karyawan Uji Agenda",
        role: "KARYAWAN",
        status: "AKTIF",
      },
    });

    const buatAgenda = (
      judul: string,
      status: "PENDING_VERIFIKASI" | "DIVERIFIKASI" | "DITOLAK",
      tanggalSelesai: Date | null = new Date("2026-09-15T03:00:00Z")
    ) =>
      prisma.agenda.create({
        data: {
          judul: `${PREFIX}-${judul}`,
          sumber: "MANDIRI_KARYAWAN",
          status,
          targetEmployeeId: kar.id,
          createdById: kar.id,
          diselesaikanPada: tanggalSelesai,
        },
      });

    const terverifikasi = await buatAgenda("VERIF", "DIVERIFIKASI");
    const pending = await buatAgenda("PENDING", "PENDING_VERIFIKASI");
    const ditolak = await buatAgenda("DITOLAK", "DITOLAK");

    // ================= [1] Guard status =================
    console.log("\n[1] Hanya agenda DIVERIFIKASI boleh punya nominal");
    let r = await setNominal(jar, pending.id, 50_000);
    assert(r.status === 409, "agenda PENDING → 409", r);
    let a = await prisma.agenda.findUnique({ where: { id: pending.id }, select: { nominal: true } });
    assert(a?.nominal === null, "nominal agenda PENDING tetap null", a);

    r = await setNominal(jar, ditolak.id, 50_000);
    assert(r.status === 409, "agenda DITOLAK → 409", r);
    a = await prisma.agenda.findUnique({ where: { id: ditolak.id }, select: { nominal: true } });
    assert(a?.nominal === null, "nominal agenda DITOLAK tetap null", a);

    r = await setNominal(jar, terverifikasi.id, 50_000, "Uji bonus");
    assert(r.status === 200, "agenda DIVERIFIKASI → 200", r);
    a = await prisma.agenda.findUnique({ where: { id: terverifikasi.id }, select: { nominal: true } });
    assert(a?.nominal === 50_000, "nominal tersimpan = 50.000", a);

    // ================= [2] Audit log =================
    console.log("\n[2] Audit log per perubahan");
    const audit = await prisma.auditLog.findMany({
      where: { recordId: terverifikasi.id, tabel: "Agenda" },
      orderBy: { createdAt: "asc" },
    });
    assert(audit.length === 1, `tepat 1 baris AuditLog (${audit.length})`, audit.length);
    const first = audit[0] as unknown as { nilaiSebelum: { nominal: number | null }; nilaiSesudah: { nominal: number } } | undefined;
    assert(
      first?.nilaiSebelum?.nominal === null,
      "nilaiSebelum.nominal = null (sebelum diset)",
      first?.nilaiSebelum
    );
    assert(
      first?.nilaiSesudah?.nominal === 50_000,
      "nilaiSesudah.nominal = 50.000",
      first?.nilaiSesudah
    );

    // Ubah lagi → nilai SEBELUM harus angka lama, bukan null.
    r = await setNominal(jar, terverifikasi.id, 75_000);
    assert(r.status === 200, "ubah nominal kedua kali → 200", r);
    const audit2 = await prisma.auditLog.findMany({
      where: { recordId: terverifikasi.id, tabel: "Agenda" },
      orderBy: { createdAt: "asc" },
    });
    assert(audit2.length === 2, `2 baris AuditLog setelah diubah lagi (${audit2.length})`);
    const second = audit2[1] as unknown as { nilaiSebelum: { nominal: number | null } } | undefined;
    assert(
      second?.nilaiSebelum?.nominal === 50_000,
      "nilaiSebelum pada perubahan kedua = 50.000 (history lengkap)",
      second?.nilaiSebelum
    );

    // ================= [3] Guard payroll LOCKED =================
    console.log("\n[3] Guard payroll LOCKED");
    const periode = periodeDariTanggalShift(new Date("2026-09-15T00:00:00Z"));
    const payroll = await prisma.payroll.create({
      data: {
        employeeId: kar.id,
        periode,
        gajiPokok: 0,
        totalBonusAgenda: 0,
        totalPotonganTelat: 0,
        bonusManual: 0,
        potonganManual: 0,
        bonusPerforma: 0,
        totalGaji: 0,
        status: "LOCKED",
        lockedAt: new Date(),
      },
    });
    assert(Boolean(payroll.id), "payroll uji dibuat dengan status LOCKED");

    const sebelum3 = await prisma.agenda.findUnique({
      where: { id: terverifikasi.id },
      select: { nominal: true },
    });
    r = await setNominal(jar, terverifikasi.id, 999_000);
    assert(r.status === 409, "ubah nominal saat payroll LOCKED → 409", r);
    assert(
      String(r.body?.error ?? "").includes("dikunci"),
      "pesan error menyebut payroll sudah dikunci",
      r.body
    );
    const sesudah3 = await prisma.agenda.findUnique({
      where: { id: terverifikasi.id },
      select: { nominal: true },
    });
    assert(
      sesudah3?.nominal === sebelum3?.nominal,
      "nominal TIDAK berubah saat ditolak (payslip tetap konsisten)",
      { sebelum: sebelum3?.nominal, sesudah: sesudah3?.nominal }
    );

    // ================= [4] Propagate dari template =================
    console.log("\n[4] Propagate template hanya ke turunan DIVERIFIKASI");
    await prisma.payroll.delete({ where: { id: payroll.id } });

    const template = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-TEMPLATE`,
        sumber: "TEMPLATE_PUSAT",
        createdById: kar.id,
      },
    });
    const turunanVerif = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-TURUNAN-VERIF`,
        sumber: "TEMPLATE_PUSAT",
        templateId: template.id,
        status: "DIVERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
        diselesaikanPada: new Date("2026-09-16T03:00:00Z"),
      },
    });
    const turunanPending = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-TURUNAN-PENDING`,
        sumber: "TEMPLATE_PUSAT",
        templateId: template.id,
        status: "PENDING_VERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
      },
    });

    r = await setNominal(jar, template.id, 120_000);
    assert(r.status === 200, "set nominal template → 200", r);
    assert(
      r.body?.propagatedCount === 1,
      "hanya 1 turunan yang dipropagasi (turunannya DIVERIFIKASI)",
      r.body
    );
    const t1 = await prisma.agenda.findUnique({ where: { id: turunanVerif.id }, select: { nominal: true } });
    const t2 = await prisma.agenda.findUnique({ where: { id: turunanPending.id }, select: { nominal: true } });
    assert(t1?.nominal === 120_000, "turunan DIVERIFIKASI dapat nominal", t1);
    assert(
      t2?.nominal === null,
      "turunan PENDING TIDAK dapat nominal (belum dikerjakan)",
      t2
    );

    // ================= [5] Batch preview & commit =================
    console.log("\n[5] Batch: preview tidak mengubah, commit menulis audit");
    const batchA = await buatAgenda("BATCH-A", "DIVERIFIKASI");

    r = await batchNominal(jar, { nominal: 60_000, preview: true, templateId: null });
    // Filter wajib — tanpa sumber/template harus 400.
    assert(r.status === 400, "batch tanpa filter → 400", r);

    // Preview dengan filter yang menyasar agenda uji lewat judul tidak bisa
    // (API tidak punya filter judul), jadi pakai templateId turunan uji.
    r = await batchNominal(jar, {
      nominal: 60_000,
      preview: true,
      templateId: template.id,
    });
    assert(r.status === 200, "batch preview → 200", r);
    assert(typeof r.body?.total === "number", "preview mengembalikan total", r.body);

    // Yang sudah punya nominal tidak boleh dihitung lagi.
    const totalPreview = r.body?.total as number;
    assert(
      totalPreview === 0,
      "preview = 0 karena turunan DIVERIFIKASI sudah punya nominal dari propagate",
      { totalPreview }
    );

    const b1 = await prisma.agenda.findUnique({ where: { id: batchA.id }, select: { nominal: true } });
    assert(b1?.nominal === null, "preview tidak mengubah data sama sekali", b1);

    // Buat agenda uji yang cocok untuk commit batch via sumber + tanpa template:
    // karena batch tanpa filter ditolak, pakai templateId baru khusus batch.
    const templateBatch = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-TEMPLATE-BATCH`,
        sumber: "TEMPLATE_PUSAT",
        createdById: kar.id,
      },
    });
    const bt1 = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-BT-1`,
        sumber: "TEMPLATE_PUSAT",
        templateId: templateBatch.id,
        status: "DIVERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
        diselesaikanPada: new Date("2026-09-17T03:00:00Z"),
      },
    });
    const bt2 = await prisma.agenda.create({
      data: {
        judul: `${PREFIX}-BT-2`,
        sumber: "TEMPLATE_PUSAT",
        templateId: templateBatch.id,
        status: "DIVERIFIKASI",
        targetEmployeeId: kar.id,
        createdById: kar.id,
        diselesaikanPada: new Date("2026-09-18T03:00:00Z"),
      },
    });

    r = await batchNominal(jar, { nominal: 60_000, preview: true, templateId: templateBatch.id });
    assert(r.body?.total === 2, "preview total = 2", r.body);
    const bt1a = await prisma.agenda.findUnique({ where: { id: bt1.id }, select: { nominal: true } });
    assert(bt1a?.nominal === null, "preview tidak mengubah apa pun (dicek ulang)", bt1a);

    r = await batchNominal(jar, { nominal: 60_000, templateId: templateBatch.id, alasan: "Uji batch" });
    assert(r.status === 200 && r.body?.updated === 2, "commit batch → 2 agenda diubah", r);

    const auditBt = await prisma.auditLog.findMany({
      where: { tabel: "Agenda", recordId: { in: [bt1.id, bt2.id] } },
    });
    assert(
      auditBt.length === 2,
      `audit per record ditulis (${auditBt.length}, harus 2)`,
      auditBt.length
    );
  } catch (e) {
    console.error("\n💥 Gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    console.log("\n[6] Cleanup");
    try {
      const agendas = await prisma.agenda.findMany({
        where: { judul: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = agendas.map((a) => a.id);
      if (ids.length > 0) {
        await prisma.auditLog.deleteMany({ where: { tabel: "Agenda", recordId: { in: ids } } });
        await prisma.agenda.deleteMany({ where: { id: { in: ids } } });
      }
      const users = await prisma.user.findMany({
        where: { kode: { startsWith: PREFIX } },
        select: { id: true },
      });
      for (const x of users) {
        await prisma.auditLog.deleteMany({ where: { actorId: x.id } });
        await prisma.riwayatPenempatan.deleteMany({ where: { employeeId: x.id } });
        await prisma.attendance.deleteMany({ where: { employeeId: x.id } });
        await prisma.gajiPokok.deleteMany({ where: { employeeId: x.id } });
        await prisma.payroll.deleteMany({ where: { employeeId: x.id } });
        await prisma.user.delete({ where: { id: x.id } });
      }
      const residu =
        (await prisma.agenda.count({ where: { judul: { contains: "UJIAGENDA" } } })) +
        (await prisma.user.count({ where: { kode: { contains: "UJIAGENDA" } } }));
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
