import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const ALLOWED_ROLES = ["ADMIN", "MANAJER", "SUPERVISOR"];
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const HARI_MS = 24 * 60 * 60 * 1000;

function parseTanggalUTC(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

function formatTanggalUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// tanggalUTC = UTC midnight of date D. WIB midnight of D = tanggalUTC - WIB_OFFSET.
// Hasil: instant yang merepresentasikan (jam WIB) pada tanggal D.
function shiftTimeFromMenit(tanggalUTC: Date, menit: number): Date {
  return new Date(tanggalUTC.getTime() - WIB_OFFSET_MS + menit * 60_000);
}

// Cek apakah template berlaku untuk tanggal tertentu
// hariKerja: array Int (0=Minggu, 1=Senin, ..., 6=Sabtu)
// Array kosong = SEMUA hari
function templateCocokHari(hariKerja: number[], tanggalUTC: Date): boolean {
  if (hariKerja.length === 0) return true; // SEMUA hari
  const hari = tanggalUTC.getUTCDay(); // 0=Minggu..6=Sabtu (UTC date = WIB date untuk date-only)
  return hariKerja.includes(hari);
}

// POST /api/shift-instance/generate
// Body: { storeId, tanggalMulai: "YYYY-MM-DD", jumlahHari: 1-31, modeRotasi: "HARIAN" | "MINGGUAN" }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json(
        { error: "Role Anda tidak berwenang membuat jadwal." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
    }

    const storeId = body.storeId;
    const tanggalMulaiStr = body.tanggalMulai;
    const jumlahHariRaw = body.jumlahHari;
    const modeRotasi = body.modeRotasi;

    if (typeof storeId !== "string" || storeId.length === 0) {
      return NextResponse.json({ error: "Field 'storeId' wajib diisi" }, { status: 400 });
    }
    if (typeof tanggalMulaiStr !== "string") {
      return NextResponse.json(
        { error: "Field 'tanggalMulai' wajib diisi (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const tanggalMulai = parseTanggalUTC(tanggalMulaiStr);
    if (!tanggalMulai) {
      return NextResponse.json(
        { error: "Format 'tanggalMulai' tidak valid (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (
      typeof jumlahHariRaw !== "number" ||
      !Number.isInteger(jumlahHariRaw) ||
      jumlahHariRaw < 1 ||
      jumlahHariRaw > 31
    ) {
      return NextResponse.json(
        { error: "Field 'jumlahHari' harus integer 1-31" },
        { status: 400 }
      );
    }
    const jumlahHari = jumlahHariRaw;

    if (modeRotasi !== "HARIAN" && modeRotasi !== "MINGGUAN") {
      return NextResponse.json(
        { error: "Field 'modeRotasi' harus 'HARIAN' atau 'MINGGUAN'" },
        { status: 400 }
      );
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    // Ambil SEMUA template aktif, filter per hari nanti di loop
    const templates = await prisma.shiftTemplate.findMany({
      where: { storeId, aktif: true },
      orderBy: { jamMulaiMenit: "asc" },
    });
    if (templates.length === 0) {
      return NextResponse.json(
        { error: "Toko ini belum punya shift template aktif." },
        { status: 400 }
      );
    }

    const employees = await prisma.user.findMany({
      where: {
        storeId,
        status: "AKTIF",
        role: { in: ["KARYAWAN", "KEPALA_TOKO"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, nama: true },
    });
    if (employees.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada karyawan aktif di toko ini." },
        { status: 400 }
      );
    }

    // Build tanggalList
    const tanggalList: Date[] = [];
    for (let i = 0; i < jumlahHari; i++) {
      tanggalList.push(new Date(tanggalMulai.getTime() + i * HARI_MS));
    }

    // Cek conflict untuk SEMUA tanggal di range
    const conflict = await prisma.shiftInstance.findFirst({
      where: { storeId, tanggal: { in: tanggalList } },
      select: { tanggal: true },
    });
    if (conflict?.tanggal) {
      return NextResponse.json(
        {
          error: `Sudah ada jadwal pada tanggal ${formatTanggalUTC(conflict.tanggal)}. Hapus atau ubah jadwal tersebut terlebih dahulu.`,
        },
        { status: 409 }
      );
    }

    const batchId = randomUUID();
    const createdById = session.user.id;

    const floatingPerHari: Array<{
      tanggal: string;
      employees: Array<{ id: string; nama: string }>;
      reason?: string; // "LIBUR" kalau tidak ada template cocok
    }> = [];

    const created = await prisma.$transaction(
      async (tx) => {
        let instanceCount = 0;
        let assignmentCount = 0;
        const createdInstances: Array<{
          id: string;
          storeId: string;
          templateId: string | null;
          tanggal: Date;
          jamMulai: Date;
          jamSelesai: Date;
          statusJadwal: string;
          sumberJadwal: string;
          batchId: string | null;
          createdById: string;
        }> = [];

        for (let i = 0; i < jumlahHari; i++) {
          const tanggalUTC = tanggalList[i]!;
          if (!tanggalUTC) continue;
          const tanggalUTCValue = tanggalUTC;

          // Filter template yang cocok untuk hari ini
          const templatesHariIni = templates.filter((t) =>
            templateCocokHari(t.hariKerja, tanggalUTCValue)
          );

          if (templatesHariIni.length === 0) {
            // Hari libur / tidak ada shift: semua karyawan floating
            floatingPerHari.push({
              tanggal: formatTanggalUTC(tanggalUTCValue),
              employees: employees.map((e) => ({ id: e.id, nama: e.nama })),
              reason: "LIBUR",
            });
            continue;
          }

          // Validasi kapasitas per hari ini
          const kapasitasPerShift = Math.floor(employees.length / templatesHariIni.length);
          if (kapasitasPerShift < 1) {
            throw new Error(
              `Karyawan (${employees.length}) kurang dari shift hari ${formatTanggalUTC(tanggalUTCValue)} (${templatesHariIni.length} shift).`
            );
          }

          const rotationStep = modeRotasi === "MINGGUAN" ? Math.floor(i / 7) : i;
          const rotationOffset = (rotationStep * kapasitasPerShift) % employees.length;

          const totalAssignedThisDay = kapasitasPerShift * templatesHariIni.length;
          const assignedEmployeeIds: string[] = [];
          for (let k = 0; k < totalAssignedThisDay; k++) {
            const idx = (rotationOffset + k) % employees.length;
            assignedEmployeeIds.push(employees[idx]!.id);
          }

          const assignedSet = new Set(assignedEmployeeIds);
          const floating = employees.filter((e) => !assignedSet.has(e.id));
          floatingPerHari.push({
            tanggal: formatTanggalUTC(tanggalUTCValue),
            employees: floating.map((e) => ({ id: e.id, nama: e.nama })),
          });

          for (let t = 0; t < templatesHariIni.length; t++) {
            const template = templatesHariIni[t];
            if (!template) continue;

            const jamMulai = shiftTimeFromMenit(tanggalUTC, template.jamMulaiMenit);
            const selesaiTanggalUTC = template.lintasHari
              ? new Date(tanggalUTC.getTime() + HARI_MS)
              : tanggalUTC;
            const jamSelesai = shiftTimeFromMenit(
              selesaiTanggalUTC,
              template.jamSelesaiMenit
            );

            const employeeIdsForShift: string[] = [];
            for (let k = 0; k < kapasitasPerShift; k++) {
              const idx = t * kapasitasPerShift + k;
              if (idx < totalAssignedThisDay) {
                employeeIdsForShift.push(assignedEmployeeIds[idx]!);
              }
            }

            const instance = await tx.shiftInstance.create({
              data: {
                storeId,
                templateId: template!.id,
                tanggal: tanggalUTC,
                jamMulai,
                jamSelesai,
                statusJadwal: "DRAFT",
                sumberJadwal: "AUTO",
                batchId,
                createdById,
                assignments: {
                  create: employeeIdsForShift.map((empId) => ({
                    employeeId: empId,
                    segmen: "NORMAL",
                    jamMulai,
                    jamSelesai,
                    createdById,
                  })),
                },
              },
            });
            createdInstances.push({
              id: instance.id,
              storeId: instance.storeId,
              templateId: instance.templateId,
              tanggal: instance.tanggal,
              jamMulai: instance.jamMulai,
              jamSelesai: instance.jamSelesai,
              statusJadwal: instance.statusJadwal,
              sumberJadwal: instance.sumberJadwal,
              batchId: instance.batchId,
              createdById: instance.createdById,
            });
            instanceCount += 1;
            assignmentCount += employeeIdsForShift.length;
          }
        }

        // Batch create audit logs for all created instances
        if (createdInstances.length > 0) {
          await tx.auditLog.createMany({
            data: createdInstances.map((inst) => ({
              tabel: "ShiftInstance",
              recordId: inst.id,
              aksi: "CREATE",
              nilaiSesudah: {
                id: inst.id,
                storeId: inst.storeId,
                templateId: inst.templateId,
                tanggal: inst.tanggal.toISOString().slice(0, 10),
                jamMulai: inst.jamMulai.toISOString(),
                jamSelesai: inst.jamSelesai.toISOString(),
                statusJadwal: inst.statusJadwal,
                sumberJadwal: inst.sumberJadwal,
                batchId: inst.batchId,
                createdById: inst.createdById,
              },
              actorId: session.user.id,
            })),
          });
        }

        return { instanceCount, assignmentCount };
      },
      { timeout: 30000 }
    );

    return NextResponse.json(
      {
        batchId,
        periode: {
          tanggalMulai: formatTanggalUTC(tanggalMulai),
          tanggalSelesai: formatTanggalUTC(tanggalList[tanggalList.length - 1]!),
        },
        jumlahInstance: created.instanceCount,
        jumlahAssignment: created.assignmentCount,
        floatingPerHari,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/shift-instance/generate error:", err);
    const msg = err instanceof Error ? err.message : "Gagal membuat jadwal otomatis.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}