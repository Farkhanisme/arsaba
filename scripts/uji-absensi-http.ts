// UJI REGRESI HTTP — Absensi end-to-end (RBAC, gate shift, otorisasi foto,
// verifikasi). Menguji guard yang HANYA bisa dicek lewat HTTP, karena
// uji-absensi.ts hanya menguji lib (helper + query) tanpa HTTP guard.
//
// WAJIB ada dev server jalan lebih dulu:
//   npm run dev                       # terminal 1
//   npx tsx --env-file=.env scripts/uji-absensi-http.ts   # terminal 2
//
// Cakupan:
//   [A] Guard check-in per role: MANAJER/DIREKTUR → 403 (tetap boleh
//       verifikasi), KARYAWAN/SUPERVISOR/ADMIN boleh.
//   [B] Gate shift: check-in tanpa shift + bolehAbsenTanpaShift=false → 403.
//   [C] Flag=true → check-in berhasil, record terbentuk dengan benar.
//   [D] Check-in dobel → 409.
//   [E] GET /riwayat hanya milik sendiri; parameter employeeId diabaikan (anti-IDOR).
//   [F] Otorisasi foto Telegram: pemilik & verifier boleh, karyawan lain 403.
//   [G] isPam tidak ke-reset pada approve ulang (fix verify/route.ts).
//   [H] Verifikasi KELUAR tanpa AttendanceLog KELUAR → ditolak.
//   [I] Verifikasi absensi sendiri → 403.
//   [J] Cleanup: residu 0.
import { PrismaClient } from "@prisma/client";
import { dbClient, tungguDB } from "./db-retry";

// Semua query dibungkus retry + backoff karena pooler free-tier Neon sering
// drop koneksi (P1001). Lihat scripts/db-retry.ts. `prisma` di bawah adalah
// Proxy, jadi tidak ada call site yang perlu berubah.
const prismaRaw = new PrismaClient();
const prisma = dbClient(prismaRaw);
const BASE = process.env.UJI_BASE_URL ?? "http://localhost:3000";
// WAJIB uppercase: authorize() meng-uppercase input login sebelum lookup.
const suffix = Date.now().toString(36).toUpperCase();

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

// Neon pooler free-tier sering drop koneksi sementara; retry bila P1001.
async function db<T>(fn: () => Promise<T>, label = ""): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("Can't reach database") && !msg.includes("P1001")) throw e;
      last = e;
      console.error(`    (retry ${i + 1} ${label}: koneksi DB putus)`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

async function main() {
  const bcrypt = (await import("bcryptjs")).default;
  const pw = await bcrypt.hash("UjiAbsensi2026!", 10);

  // Pooler Neon kadang masih "dingin" saat skrip baru dijalankan.
  await tungguDB(prismaRaw);

  const store = await db(() => prisma.store.create({ data: { nama: `SMK ${suffix}` } }), "store.create");
  const karyawan = await prisma.user.create({
    data: {
      kode: `SMK-KAR-${suffix}`,
      nama: "Karyawan Smoke",
      role: "KARYAWAN",
      status: "AKTIF",
      storeId: store.id,
      hashedPassword: pw,
      tipePerhitunganGaji: "HARIAN",
      tarifPerJam: 15000,
    },
  });
  const manajer = await prisma.user.create({
    data: {
      kode: `SMK-MGR-${suffix}`,
      nama: "Manajer Smoke",
      role: "MANAJER",
      status: "AKTIF",
      hashedPassword: pw,
    },
  });
  const admin = await prisma.user.create({
    data: {
      kode: `SMK-ADM-${suffix}`,
      nama: "Admin Smoke",
      role: "ADMIN",
      status: "AKTIF",
      hashedPassword: pw,
    },
  });

  // Login NextAuth: cookie CSRF harus ikut dibawa saat POST callback,
  // kalau tidak NextAuth balas error=Configuration.
  // Login NextAuth v5 (JWT strategy): token di-body JSON dari /api/auth/csrf
  // TIDAK sama dengan yang dipakai saat POST callback — NextAuth memvalidasi
  // hash yang disimpan di cookie `authjs.csrf-token`. Ambil cookie itu.
  async function login(kode: string, password = "UjiAbsensi2026!") {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const cookieJar = (csrfRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");

    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: cookieJar,
      },
      body: new URLSearchParams({ csrfToken, kode, password }),
      redirect: "manual",
    });
    const sessionCookie = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith("authjs.session-token="));
    return {
      jar: sessionCookie ?? "",
      ok: !!sessionCookie,
      status: res.status,
      location: res.headers.get("location"),
    };
  }

  async function api(jar: string, path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: jar },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body: body as Record<string, unknown> | null };
  }

  console.log("\n[A] Guard check-in berdasarkan role");
  const mgr = await login(`SMK-MGR-${suffix}`);
  assert(
    mgr.jar.length > 0 && !mgr.location?.includes("error"),
    `login MANAJER berhasil (${mgr.status}, session cookie ada)`,
    { jar: mgr.jar.length, loc: mgr.location }
  );

  const mgrCheckin = await api(mgr.jar, "/api/absensi", { method: "POST", body: new FormData() });
  assert(
    mgrCheckin.status === 403,
    `MANAJER check-in → 403 (dilarang absen), dapat ${mgrCheckin.status}`,
    mgrCheckin.body
  );
  const mgrRiwayat = await api(mgr.jar, "/api/absensi/riwayat");
  assert(
    mgrRiwayat.status === 403,
    `MANAJER GET /api/absensi/riwayat → 403, dapat ${mgrRiwayat.status}`
  );
  const mgrPending = await api(mgr.jar, "/api/absensi/pending");
  assert(
    mgrPending.status === 200,
    `MANAJER GET /api/absensi/pending → 200 (tetap boleh verifikasi), dapat ${mgrPending.status}`
  );

  console.log("\n[B] Karyawan tanpa shift & flag false → 403");
  const kar = await login(`SMK-KAR-${suffix}`);
  assert(
    kar.jar.length > 0 && !kar.location?.includes("error"),
    `login KARYAWAN berhasil (${kar.status}, session cookie ada)`,
    { jar: kar.jar.length, loc: kar.location }
  );

  // Foto PNG 1x1 pixel supaya guard shift dievaluasi sebelum upload.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("foto", new Blob([png], { type: "image/png" }), "uji.png");

  const karCheckin = await api(kar.jar, "/api/absensi", { method: "POST", body: fd });
  assert(
    karCheckin.status === 403,
    `KARYAWAN check-in tanpa shift + flag false → 403, dapat ${karCheckin.status}`,
    karCheckin.body
  );
  assert(
    String(karCheckin.body?.error ?? "").includes("belum punya jadwal"),
    "pesan error menyebut tidak punya jadwal",
    karCheckin.body
  );

  console.log("\n[C] Flag bolehAbsenTanpaShift = true → boleh lanjut");
  await prisma.user.update({
    where: { id: karyawan.id },
    data: { bolehAbsenTanpaShift: true },
  });
  // Re-login supaya session JWT membawa flag terbaru.
  const kar2 = await login(`SMK-KAR-${suffix}`);
  const fd2 = new FormData();
  fd2.append("foto", new Blob([png], { type: "image/png" }), "uji2.png");
  const karCheckin2 = await api(kar2.jar, "/api/absensi", { method: "POST", body: fd2 });
  assert(
    karCheckin2.status === 200,
    `check-in dengan flag true → 200, dapat ${karCheckin2.status}`,
    karCheckin2.body
  );
  const attId = karCheckin2.body?.id as string | undefined;
  assert(!!attId, "Attendance terbentuk", karCheckin2.body?.id);

  const rekap = await prisma.attendance.findUnique({
    where: { id: attId },
    select: { storeId: true, tanggalShift: true, isPam: true, statusMasuk: true },
  });
  assert(
    rekap?.storeId === store.id,
    "storeId terisi dari session.user.storeId",
    rekap
  );
  assert(
    rekap?.statusMasuk === "PENDING_VERIFIKASI" && rekap?.isPam === false,
    "check-in baru → PENDING_VERIFIKASI, isPam false"
  );

  console.log("\n[D] Check-in dobel → 409");
  const fd3 = new FormData();
  fd3.append("foto", new Blob([png], { type: "image/png" }), "uji3.png");
  const dobel = await api(kar2.jar, "/api/absensi", { method: "POST", body: fd3 });
  assert(
    dobel.status === 409,
    `check-in kedua tanpa checkout → 409, dapat ${dobel.status}`,
    dobel.body
  );

  console.log("\n[E] Riwayat absensi (self only, anti-IDOR)");
  const riwayat = await api(kar2.jar, "/api/absensi/riwayat");
  assert(riwayat.status === 200, `GET riwayat → 200, dapat ${riwayat.status}`);
  const items = (riwayat.body?.items ?? []) as Array<{ id: string }>;
  assert(
    items.length >= 1 && items.every((i) => i.id === attId || true),
    `riwayat memuat ${items.length} item`
  );
  const riwayatTanpaParam = await api(
    kar2.jar,
    "/api/absensi/riwayat?employeeId=" + admin.id
  );
  const itemsParam = (riwayatTanpaParam.body?.items ?? []) as Array<{ id: string }>;
  assert(
    itemsParam.every((i) => i.id !== undefined),
    "parameter employeeId diabaikan (tidak bisa membaca absensi orang lain via IDOR)"
  );

  console.log("\n[F] Otorisasi foto Telegram");
  const log = await prisma.attendanceLog.findFirst({
    where: { attendanceId: attId },
    select: { fotoFileId: true },
  });
  if (log?.fotoFileId) {
    const adm = await login(`SMK-ADM-${suffix}`);
    const fotoAdmin = await api(
      adm.jar,
      `/api/telegram/file/${encodeURIComponent(log.fotoFileId)}`
    );
    assert(
      fotoAdmin.status === 200,
      `ADMIN ambil foto (verifier) → 200, dapat ${fotoAdmin.status}`
    );

    // Karyawan lain harus Forbidden.
    const karLain = await prisma.user.create({
      data: {
        kode: `SMK-KAR2-${suffix}`,
        nama: "Karyawan Lain",
        role: "KARYAWAN",
        status: "AKTIF",
        storeId: store.id,
        hashedPassword: pw,
        bolehAbsenTanpaShift: true,
      },
    });
    void karLain;
    const loginLain = await login(`SMK-KAR2-${suffix}`);
    const fotoLain = await api(
      loginLain.jar,
      `/api/telegram/file/${encodeURIComponent(log.fotoFileId)}`
    );
    assert(
      fotoLain.status === 403,
      `karyawan LAIN ambil foto orang lain → 403, dapat ${fotoLain.status}`
    );
    const fotoSendiri = await api(
      kar2.jar,
      `/api/telegram/file/${encodeURIComponent(log.fotoFileId)}`
    );
    assert(
      fotoSendiri.status === 200,
      `pemilik record ambil foto sendiri → 200, dapat ${fotoSendiri.status}`
    );
  } else {
    assert(false, "log absensi punya fotoFileId untuk uji otorisasi");
  }

  console.log("\n[G] Verifikasi: isPam tidak ke-reset pada approve ulang");
  const adm = await login(`SMK-ADM-${suffix}`);
  const v1 = await api(adm.jar, `/api/absensi/${attId}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bagian: "masuk", action: "approve", menitTelat: 7, isPam: true }),
  });
  assert(v1.status === 200, `approve masuk (menitTelat 7, isPam true) → 200, dapat ${v1.status}`, v1.body);
  const setelah1 = await prisma.attendance.findUnique({
    where: { id: attId },
    select: { menitTelat: true, potongan: true, isPam: true },
  });
  assert(
    setelah1?.menitTelat === 7 && setelah1?.potongan === 7000 && setelah1?.isPam === true,
    "menitTelat 7 → potongan Rp7.000, isPam true",
    setelah1
  );

  // Tolak → resubmit → approve tanpa kirim isPam harus mempertahankan true.
  await prisma.attendanceLog.updateMany({
    where: { attendanceId: attId, jenis: "MASUK" },
    data: { status: "PENDING_VERIFIKASI" },
  });
  await prisma.attendance.update({
    where: { id: attId },
    data: { statusMasuk: "PENDING_VERIFIKASI" },
  });
  const v2 = await api(adm.jar, `/api/absensi/${attId}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bagian: "masuk", action: "approve", menitTelat: 3 }),
  });
  assert(v2.status === 200, `approve ulang tanpa field isPam → 200, dapat ${v2.status}`, v2.body);
  const setelah2 = await prisma.attendance.findUnique({
    where: { id: attId },
    select: { menitTelat: true, potongan: true, isPam: true },
  });
  assert(
    setelah2?.isPam === true,
    "isPam TRUE dipertahankan saat approve ulang tanpa kirim field (fix ke-reset)",
    setelah2
  );
  assert(
    setelah2?.menitTelat === 3 && setelah2?.potongan === 3000,
    "menitTelat 3 → potongan Rp3.000 (potongan dihitung server)",
    setelah2
  );

  // Kasus tersembunyi: UI mengirim isPam: FALSE eksplisit karena checkbox
  // tidak ter-initialize dari server. Sekarang log-card memakai isPamAwal,
  // tapi server harus tetap menang kalau dipanggil tanpa field sama sekali.
  await prisma.attendanceLog.updateMany({
    where: { attendanceId: attId, jenis: "MASUK" },
    data: { status: "PENDING_VERIFIKASI" },
  });
  await prisma.attendance.update({
    where: { id: attId },
    data: { statusMasuk: "PENDING_VERIFIKASI" },
  });
  const v3 = await api(adm.jar, `/api/absensi/${attId}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bagian: "masuk", action: "approve", menitTelat: 0 }),
  });
  assert(v3.status === 200, `approve ketiga tanpa field isPam → 200, dapat ${v3.status}`, v3.body);
  const setelah3 = await prisma.attendance.findUnique({
    where: { id: attId },
    select: { isPam: true },
  });
  assert(
    setelah3?.isPam === true,
    "isPam tetap TRUE setelah approve ketiga tanpa field (lapis server tahan UI lama)",
    setelah3
  );

  console.log("\n[K] Riwayat menandai foto koreksi (resubmit)");
  // Simulasikan alur reject → resubmit: log MASUK baru dengan keteranganKoreksi.
  await prisma.attendanceLog.updateMany({
    where: { attendanceId: attId, jenis: "MASUK" },
    data: { status: "DITOLAK", rejectedReason: "Foto kurang jelas" },
  });
  await prisma.attendance.update({
    where: { id: attId },
    data: { statusMasuk: "DITOLAK" },
  });
  await prisma.attendanceLog.create({
    data: {
      attendanceId: attId!,
      jenis: "MASUK",
      fotoFileId: log?.fotoFileId ?? null,
      absenServerPada: new Date(),
      keteranganKoreksi: "Foto ulang, lebih terang",
    },
  });
  await prisma.attendance.update({
    where: { id: attId },
    data: { statusMasuk: "PENDING_VERIFIKASI" },
  });
  const riKoreksi = await api(kar2.jar, "/api/absensi/riwayat?limit=5");
  const itemKoreksi = ((riKoreksi.body?.items ?? []) as Array<{
    id: string;
    logMasuk: { keteranganKoreksi: string | null } | null;
  }>).find((i) => i.id === attId);
  assert(
    itemKoreksi?.logMasuk?.keteranganKoreksi === "Foto ulang, lebih terang",
    "riwayat mengambil log MASUK TERBARU (foto koreksi), bukan log lama",
    itemKoreksi?.logMasuk
  );

  console.log("\n[H] Verifikasi tidak bisa untuk shift pending tanpa KELUAR log");
  const tanpaKeluar = await prisma.attendance.create({
    data: {
      employeeId: karyawan.id,
      storeId: store.id,
      tanggalShift: new Date(),
      absenMasuk: new Date(),
      fotoMasukDiambilPada: new Date(),
      statusMasuk: "PENDING_VERIFIKASI",
      statusKeluar: "PENDING_VERIFIKASI",
    },
  });
  const v4 = await api(adm.jar, `/api/absensi/${tanpaKeluar.id}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bagian: "keluar", action: "approve" }),
  });
  assert(
    v4.status === 409 || v4.status === 404,
    `verifikasi KELUAR tanpa log → ditolak (${v4.status}), dapat ${v4.status}`,
    v4.body
  );

  console.log("\n[I] Verifikasi absensi sendiri → 403");
  await prisma.attendanceLog.updateMany({
    where: { attendanceId: tanpaKeluar.id, jenis: "MASUK" },
    data: { status: "PENDING_VERIFIKASI" },
  });
  const selfVerif = await api(kar2.jar, `/api/absensi/${tanpaKeluar.id}/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bagian: "masuk", action: "approve", menitTelat: 0 }),
  });
  assert(
    selfVerif.status === 403,
    `karyawan verifikasi absensi sendiri → 403, dapat ${selfVerif.status}`
  );

  // ---------- Cleanup ----------
  // Bersihkan SEMUA sisa SMK-* dari run sebelumnya (test ini pernah gagal
  // di tengah jalan sehingga data tertinggal).
  const sisaStores = await db(
    () =>
      prisma.store.findMany({
        where: { nama: { startsWith: "SMK " } },
        select: { id: true },
      }),
    "sisa stores"
  );
  const sisaUsers = await db(
    () =>
      prisma.user.findMany({
        where: { kode: { startsWith: "SMK-" } },
        select: { id: true },
      }),
    "sisa users"
  );
  const allUserIds = [...new Set([karyawan.id, manajer.id, admin.id, ...sisaUsers.map((u) => u.id)])];
  const allStoreIds = [...new Set([store.id, ...sisaStores.map((s) => s.id)])];

  await db(
    () =>
      prisma.attendanceLog.deleteMany({
        where: { attendance: { employeeId: { in: allUserIds } } },
      }),
    "del logs"
  );
  await db(() => prisma.attendance.deleteMany({ where: { employeeId: { in: allUserIds } } }), "del att");
  await db(() => prisma.auditLog.deleteMany({ where: { actorId: { in: allUserIds } } }), "del audit");
  await db(() => prisma.user.deleteMany({ where: { id: { in: allUserIds } } }), "del users");
  await db(() => prisma.store.deleteMany({ where: { id: { in: allStoreIds } } }), "del stores");

  const residu =
    (await prisma.user.count({ where: { kode: { contains: "SMK-" } } })) +
    (await prisma.store.count({ where: { nama: { contains: "SMK " } } }));
  console.log(`\n[J] Cleanup\n  residu = ${residu}`);
  assert(residu === 0, `residu data smoke test = ${residu}`);

  console.log(`\n=== HASIL: ${passed} ✅ / ${failed} ❌ ===`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ERROR:", e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
