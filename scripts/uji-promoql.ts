// scripts/uji-promoql.ts
// P0-6 — Uji seluruh endpoint API untuk mendeteksi PrismaClientValidationError.
//
// KENAPA SKRIP INI ADA
// -------------------
// Terverifikasi empiris di repo ini: TypeScript TIDAK melakukan excess-property
// check pada object literal `select`/`where` Prisma selama ada minimal satu key
// yang valid.
//
//   prisma.agenda.findFirst({ select: { dibuatOlehId: true } })
//     -> TS2353 error  ✅ TERTANGKAP
//   prisma.agenda.findFirst({ select: { targetEmployeeId: true, dibuatOlehId: true } })
//     -> TIDAK error   ❌ LOLOS diam-diam
//
// Konsekuensinya: field Prisma yang salah ketik LOLOS `tsc` dan `next build`,
// lalu meledak saat runtime. Bug `dibuatOlehId` di /api/telegram/file/[fileId]
// lolos build dan hanya ketahuan karena happens.to be_read. Skrip ini menjadikan
// kelas bug itu terdeteksi secara sistematis, bukan oleh kebetulan.
//
// DIJALANKAN
//   1) npm run dev            (terminal lain)
//   2) npx tsx --env-file=.env scripts/uji-promoql.ts
//
// Script ini SENGAJA membuat satu agenda `__uji__` (route POST /api/agenda memang
// lolos validasi dan membuat record). Semua record uji dihapus otomatis di akhir —
// termasuk jika script gagal di tengah jalan (blok finally). ID lain memakai
// "__uji__" yang tidak mungkin ada di DB, jadi ekspektasinya 404/400/403 —
// BUKAN 500 PrismaClientValidationError.
//
// CATATAN HONEST
// --------------
// Skrip ini hanya menguji jalur yang bisa dicapai dengan payload minimal & ID
// palsu. Itu cukup untuk menangkap salah-nama field (kelas bug P0-6), tapi TIDAK
// menjamin semua cabang dalam body route tereksekusi — contoh-nya guard
// `if (bagian === "masuk")` di verify route tidak akan tersentuh. Untuk coverage
// penuh tetap perlu skrip uji per-modul (uji-agenda-http.ts, uji-payroll-http.ts,
// dst) yang sudah direncanakan di P0-2/3/4/7.

const BASE = process.env.UJI_BASE_URL ?? "http://localhost:3000";

// --- helper -----------------------------------------------------------------

type Probe = {
  method: string;
  path: string;
  body?: unknown;
  form?: Record<string, string>;
  label: string;
};

/**
 * Login dua tahap (Auth.js v5 / next-auth beta).
 *
 * Tahap 1: GET /api/auth/csrf  -> token CSRF + cookie `authjs.csrf-token`
 * Tahap 2: POST /api/auth/callback/credentials dengan csrfToken + cookie yang sama
 *
 * Tanpa tahap 1, server membalas `?error=MissingCSRF` (verifikasi:Auth.js v5
 * mewajibkan double-submit token pada credentials callback). Cookie sesi pun
 * di-set pada respons 302, jadi `redirect: "manual"` justru yang benar di sini.
 */
async function login(kode: string, password: string): Promise<string> {
  const jar = new Map<string, string>();

  const collect = (res: Response) => {
    const raw: string[] =
      res.headers.getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    for (const c of raw) {
      const [pair] = c.split(";");
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };

  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  // Tahap 1 — ambil CSRF token.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { redirect: "manual" });
  collect(csrfRes);
  const csrfJson = (await csrfRes.json().catch(() => ({}))) as { csrfToken?: string };
  if (!csrfJson.csrfToken) return "";

  // Tahap 2 — kirim credentials + token + cookie CSRF.
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(),
    },
    body: new URLSearchParams({
      kode,
      password,
      csrfToken: csrfJson.csrfToken,
      callbackUrl: `${BASE}/dashboard`,
    }),
    redirect: "manual",
  });
  collect(res);

  const loc = res.headers.get("location") ?? "";
  if (/error=/.test(loc)) return "";

  return cookieHeader();
}

function isPrismaValidation(res: Response, body: string): boolean {
  return (
    res.status >= 500 &&
    /PrismaClientValidationError|Unknown argument|Unknown field|does not exist in type|Invalid .* invocation/i.test(
      body
    )
  );
}

function isNotFound(res: Response, body: string): boolean {
  return (
    res.status === 404 ||
    /404|tidak ditemukan|not found|FORBIDDEN|UNAUTHORIZED|error|invalid|wajib|tidak boleh/i.test(body)
  );
}

// --- daftar probe -----------------------------------------------------------
// Nilai id sengaja "__uji__":_objek_ yang tidak mungkin ada di DB.

const ID = "__uji__";

function buildProbes(): Probe[] {
  return [
    // ---------- absensi ----------
    { method: "GET", path: "/api/absensi/riwayat", label: "riwayat absensi (butuh auth)" },
    { method: "GET", path: "/api/absensi/pending", label: "antrean verifikasi" },
    {
      method: "POST",
      path: "/api/absensi",
      label: "check-in (tanpa shift -> 403)",
      form: { __uji: "1" },
    },
    { method: "POST", path: "/api/absensi/checkout", label: "check-out", form: { __uji: "1" } },
    { method: "POST", path: "/api/absensi/resubmit", label: "resubmit", form: { __uji: "1" } },
    {
      method: "PATCH",
      path: `/api/absensi/${ID}/verify`,
      body: { bagian: "masuk", action: "approve", menitTelat: 0 },
      label: "verifikasi absensi",
    },
    {
      method: "PATCH",
      path: `/api/absensi/${ID}/override-keluar`,
      body: { absenKeluar: "2026-09-01T10:00:00.000Z", keterangan: "uji promoql" },
      label: "override keluar",
    },

    // ---------- agenda ----------
    { method: "GET", path: "/api/agenda", label: "list agenda" },
    {
      method: "POST",
      path: "/api/agenda",
      body: { judul: "__uji__", sumber: "TEMPLATE_PUSAT" },
      label: "buat template agenda",
    },
    {
      method: "POST",
      path: "/api/agenda/mandiri",
      body: { judul: "__uji__", deskripsi: "__uji__" },
      label: "agenda mandiri",
    },
    {
      method: "PATCH",
      path: `/api/agenda/${ID}/verify`,
      body: { action: "approve" },
      label: "verifikasi agenda",
    },
    {
      method: "POST",
      path: `/api/agenda/${ID}/selesai`,
      form: { __uji: "1" },
      label: "tandai selesai",
    },
    { method: "POST", path: `/api/agenda/${ID}/assign`, body: { targetId: ID }, label: "assign" },
    {
      method: "PATCH",
      path: `/api/agenda/${ID}/nominal`,
      body: { nominal: 1000 },
      label: "set nominal",
    },
    {
      method: "POST",
      path: "/api/agenda/nominal-batch",
      body: { nominal: 1000 },
      label: "nominal batch",
    },

    // ---------- izin ----------
    { method: "GET", path: "/api/izin", label: "list izin" },
    {
      method: "POST",
      path: "/api/izin",
      body: { employeeId: ID, tanggal: "2026-09-01", alasan: "__uji__" },
      label: "buat izin",
    },
    { method: "DELETE", path: `/api/izin/${ID}`, label: "hapus izin" },

    // ---------- payroll ----------
    { method: "GET", path: "/api/payroll", label: "list payroll" },
    { method: "GET", path: `/api/payroll/${ID}`, label: "detail payroll" },
    {
      method: "PATCH",
      path: `/api/payroll/${ID}`,
      body: { bonusManual: 1000 },
      label: "patch payroll",
    },
    { method: "PATCH", path: `/api/payroll/${ID}/lock`, body: {}, label: "lock payroll" },
    {
      method: "POST",
      path: "/api/payroll/generate",
      body: { periode: "2026-09" },
      label: "generate payroll",
    },

    // ---------- setoran ----------
    { method: "GET", path: "/api/setoran", label: "list setoran" },
    {
      method: "POST",
      path: "/api/setoran",
      body: { tipeTujuan: "PUSAT", nominalDisetor: 1000 },
      label: "buat setoran",
    },
    {
      method: "POST",
      path: `/api/setoran/${ID}/terima`,
      body: { nominalDiterima: 1000 },
      label: "terima setoran",
    },
    {
      method: "POST",
      path: `/api/setoran/${ID}/batal`,
      body: { alasan: "__uji__" },
      label: "batal setoran",
    },

    // ---------- laporan & dashboard ----------
    { method: "GET", path: "/api/laporan/kehadiran", label: "laporan kehadiran" },
    { method: "GET", path: "/api/laporan/kehadiran/rincian", label: "rincian kehadiran" },
    { method: "GET", path: "/api/dashboard/gaji", label: "estimasi gaji" },

    // ---------- master data ----------
    { method: "GET", path: "/api/store", label: "list toko" },
    { method: "PATCH", path: "/api/store/__uji__", body: { nama: "__uji__" }, label: "patch toko" },
    { method: "GET", path: "/api/user", label: "list user" },
    { method: "PATCH", path: `/api/user/${ID}`, body: { nama: "__uji__" }, label: "patch user" },
    {
      method: "PATCH",
      path: `/api/user/${ID}/gaji`,
      body: { tipePerhitunganGaji: "JAM", tarifPerJam: 1000 },
      label: "set gaji",
    },
    {
      method: "PATCH",
      path: `/api/user/${ID}/reset-password`,
      body: { passwordBaru: "__uji__" },
      label: "reset password",
    },
    // Catatan: /api/employee sudah DIHAPUS di P0-2 (dead code dengan RBAC
    // yang bertentangan dengan /api/user). Tidak ada probe untuknya lagi.

    // ---------- shift ----------
    { method: "GET", path: "/api/shift-template", label: "list shift template" },
    { method: "GET", path: `/api/shift-template/${ID}`, label: "detail shift template" },
    { method: "GET", path: "/api/shift-instance", label: "list shift instance" },
    { method: "GET", path: `/api/shift-instance/${ID}`, label: "detail shift instance" },
    {
      method: "POST",
      path: `/api/shift-instance/${ID}/assignment`,
      body: { employeeId: ID, segmen: "PAM" },
      label: "buat assignment (PAM)",
    },
    {
      method: "DELETE",
      path: `/api/shift-instance/${ID}/assignment/${ID}`,
      label: "hapus assignment",
    },
    {
      method: "POST",
      path: "/api/shift-instance/generate",
      body: { tanggal: "2026-09-01" },
      label: "generate shift",
    },
    {
      method: "GET",
      path: "/api/shift-instance/generate/preflight?tanggal=2026-09-01",
      label: "preflight shift",
    },
    { method: "PATCH", path: "/api/shift-instance/batch/__uji__/approve", body: {}, label: "approve batch" },

    // ---------- telegram proxy (P0-5) ----------
    {
      method: "GET",
      path: "/api/telegram/file/__uji_fileid_yang_panjangnya_ cukup_1234567890",
      label: "proxy foto (bukti agenda)",
    },
  ];
}

// --- main -------------------------------------------------------------------

type Row = {
  n: number;
  label: string;
  method: string;
  path: string;
  status: number | string;
  verdict: "OK" | "VALIDASI_PRISMA" | "LAIN";
  note: string;
};

async function run(label: string, jar: string | null): Promise<Row[]> {
  const probes = buildProbes();
  const rows: Row[] = [];
  let n = 0;

  for (const p of probes) {
    n += 1;
    const url = `${BASE}${p.path}`;
    const headers: Record<string, string> = {};
    if (jar) headers.Cookie = jar;

    let res: Response;
    try {
      if (p.form) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(p.form)) fd.append(k, v);
        res = await fetch(url, { method: p.method, headers, body: fd });
      } else if (p.body !== undefined) {
        headers["Content-Type"] = "application/json";
        res = await fetch(url, {
          method: p.method,
          headers,
          body: JSON.stringify(p.body),
        });
      } else {
        res = await fetch(url, { method: p.method, headers });
      }
    } catch (e) {
      rows.push({
        n,
        label: p.label,
        method: p.method,
        path: p.path,
        status: "ERR",
        verdict: "LAIN",
        note: `fetch gagal: ${String(e).slice(0, 80)}`,
      });
      continue;
    }

    const body = await res.text().catch(() => "");
    let verdict: Row["verdict"] = "OK";
    let note = "";

    if (isPrismaValidation(res, body)) {
      verdict = "VALIDASI_PRISMA";
      const m = body.match(/Unknown argument[s]?[:\s]+([^\n"]{0,80})/i);
      note = m ? `field salah: ${m[1]?.trim() ?? "(tidak terbaca)"}` : body.replace(/\s+/g, " ").slice(0, 160);
    } else if (res.status >= 500) {
      verdict = "LAIN";
      note = body.replace(/\s+/g, " ").slice(0, 160);
    } else if (res.status >= 200 && res.status < 300) {
      // 2xx itu SUCCESS yang diharapkan — route hidup & query-nya valid.
      // Jangan tandai sebagai masalah; cukup catat singkat.
      verdict = "OK";
      note = `ok (${body.replace(/\s+/g, " ").slice(0, 40)}…)`;
    } else if (!isNotFound(res, body)) {
      verdict = "LAIN";
      note = `status tak terduga: ${body.replace(/\s+/g, " ").slice(0, 100)}`;
    }

    rows.push({ n, label: p.label, method: p.method, path: p.path, status: res.status, verdict, note });
  }

  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  for (const r of rows) {
    const icon = r.verdict === "OK" ? "✅" : r.verdict === "VALIDASI_PRISMA" ? "🔴" : "🟡";
    console.log(
      `${icon} ${String(r.n).padStart(2)}. ${r.method.padEnd(6)} ${r.path.slice(0, 52).padEnd(52)} [${r.status}] ${r.note}`
    );
  }
  return rows;
}

/**
 * Hapus semua record uji yang dibuat skrip ini.
 *
 * Dua route bisa BERHASIL membuat record (payload-nya lolos validasi):
 *   - POST /api/agenda -> Agenda dengan judul "__uji__"
 *   - POST /api/user  -> User dengan nama "__uji__"
 *
 * Penting: JANGAN menghapus user berdasarkan `kode` — `kode` dibuat oleh
 * KodeCounter dan nomor urutnya dipakai user asli. Hapus berdasarkan `nama`
 * persis "__uji__" sehingga tidak mungkin mengenai data asli.
 */
async function cleanup(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const p = new PrismaClient();

  // Neon pooler free-tier sering drop koneksi (P1001) — retry dengan backoff.
  const coba = async <T>(fn: () => Promise<T>): Promise<T> => {
    let terakhir: unknown;
    for (let i = 1; i <= 5; i++) {
      try {
        return await fn();
      } catch (e) {
        terakhir = e;
        if (i < 5) await new Promise((r) => setTimeout(r, 5_000 * i));
      }
    }
    throw terakhir;
  };

  try {
    const delAgenda = await coba(() =>
      p.agenda.deleteMany({ where: { judul: "__uji__" } })
    );
    // User uji dibuat oleh probe employee. Hapus child rows dulu agar FK tidak
    // menahan (agenda sasarannya, auditLog yang dia buat).
    const users = await coba(() =>
      p.user.findMany({ where: { nama: "__uji__" }, select: { id: true } })
    );
    for (const u of users) {
      await coba(() => p.auditLog.deleteMany({ where: { actorId: u.id } }));
      await coba(() => p.agenda.deleteMany({ where: { targetEmployeeId: u.id } }));
      await coba(() => p.user.delete({ where: { id: u.id } }));
    }

    const sisaAgenda = await coba(() =>
      p.agenda.count({ where: { judul: "__uji__" } })
    );
    const sisaUser = await coba(() =>
      p.user.count({ where: { nama: "__uji__" } })
    );

    console.log(
      `\n🧹 Cleanup: agenda ${delAgenda.count}, user ${users.length} — ` +
        `sisa: agenda ${sisaAgenda}, user ${sisaUser} (keduanya harus 0).`
    );
  } catch (e) {
    const pesan = String(e).split("\n")[0] ?? "";
    console.log(`\n⚠ Cleanup gagal: ${pesan.slice(0, 120)}`);
    console.log(`  Hapus manual:`);
    console.log(`    DELETE FROM "Agenda" WHERE judul = '__uji__';`);
    console.log(`    DELETE FROM "User"   WHERE nama  = '__uji__';`);
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  console.log(`MENGUJI ${BASE}`);

  // 1) Tanpa auth — semua route harus 401/403, TIDAK boleh 500 Prisma.
  const anon = await run("[1/2] TANPA AUTH (target: 401/403, tanpa 500 Prisma)", null);

  // 2) Dengan auth. Coba beberapa kredensial dari seed.
  const seedPass = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  const candidates = [
    { kode: "EMP-002", pass: seedPass }, // Supervisor — paling banyak endpoint
    { kode: "EMP-001", pass: seedPass }, // Admin
    { kode: "MGR-001", pass: seedPass }, // Manajer
  ].filter((c): c is { kode: string; pass: string } => Boolean(c.pass));

  let authed: Row[] = [];
  let okKode = "";
  for (const c of candidates) {
    const jar = await login(c.kode, c.pass).catch(() => "");
    // Hanya terima cookie yang benar-benar berisi token sesi.
    if (jar && /authjs\.session-token|next-auth\.session-token|__Secure-.*session/i.test(jar)) {
      okKode = c.kode;
      authed = await run(`[2/2] DENGAN AUTH (${c.kode})`, jar);
      break;
    }
  }
  if (!okKode) {
    console.log(
      "\n⚠ Tidak berhasil login dengan kredensial seed. Skrip 2/2 dilewati."
    );
    console.log("  Set SEED_PASSWORD atau SEED_ADMIN_PASSWORD di .env sesuai prisma/seed.ts.");
  }

  const all = [...anon, ...authed];
  const bad = all.filter((r) => r.verdict === "VALIDASI_PRISMA");
  const lain = all.filter((r) => r.verdict === "LAIN");

  console.log(`\n${"=".repeat(78)}\nRINGKASAN\n${"=".repeat(78)}`);
  console.log(`Total probe       : ${all.length}`);
  console.log(`✅ bersih         : ${all.length - bad.length - lain.length}`);
  console.log(`🔴 validasi Prisma: ${bad.length}`);
  console.log(`🟡 perlu diperiksa: ${lain.length}`);

  if (bad.length) {
    console.log(`\n🔴 ENDPOINT DENGAN FIELD PRISMA YANG SALAH:`);
    for (const b of bad) console.log(`   ${b.method} ${b.path}\n     ${b.note}`);
  }
  if (lain.length) {
    console.log(`\n🟡 STATUS 500 / TAK TERDUGA (perlu diperiksa manual):`);
    for (const l of lain) console.log(`   ${l.method} ${l.path} [${l.status}]\n     ${l.note}`);
  }
  if (bad.length === 0) {
    console.log(
      `\n✅ Tidak ada endpoint dengan field Prisma salah. Lubang type-check P0-6\n` +
        `   terkonfirmasi TIDAK TEREKSPOSASI di ${all.length} endpoint yang diuji.`
    );
  }

  return bad.length > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error("Skrip gagal:", e);
    await cleanup();
    process.exit(2);
  });

main();
