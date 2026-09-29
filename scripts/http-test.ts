// scripts/http-test.ts
// Helper bersama untuk skrip uji HTTP (butuh `npm run dev` jalan di terminal lain).
//
// ALASAN ADA: Auth.js v5 (next-auth beta) mewajibkan alur login DUA tahap —
// `GET /api/auth/csrf` lebih dulu, lalu POST ke `/api/auth/callback/credentials`
// sambil mengirim `csrfToken` + cookie yang sama. Kalau langsung POST, server
// membalas `?error=MissingCSRF` dan cookie sesi tidak pernah terbit.
//
// Helper ini triedcentralkan supaya keempat skrip uji HTTP tidak masing-masing
// menyalin ritual yang sama (dan supaya tidak ada yang lupa tahap CSRF-nya).
//
// Login juga di-RETRY karena posisinya di server Next, yang tidak memakai
// `dbClient` — jadi saat pooler Neon drop sesaat, login gagal хотя DB-nya sebenarnya
// baik. Itu gangguan infrastruktur, bukan test failure.

const BASE = process.env.UJI_BASE_URL ?? "http://localhost:3000";

export { BASE };

/**
 * Login dan kembalikan string cookie yang siap dipakai sebagai header `Cookie`.
 * Mengembalikan string kosong kalau gagal.
 */
export async function login(kode: string, password: string): Promise<string> {
  let terakhir = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const hasil = await cobaLogin(kode, password);
      if (hasil) return hasil;
      terakhir = "login ditolak (kode/password salah, atau akun nonaktif)";
    } catch (e) {
      terakhir = e instanceof Error ? e.message : String(e);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`Login ${kode} gagal setelah 3 percobaan: ${terakhir}`);
}

async function cobaLogin(kode: string, password: string): Promise<string> {
  const jar = new Map<string, string>();

  const collect = (res: Response) => {
    const raw: string[] =
      res.headers.getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    for (const c of raw) {
      const [pair] = c.split(";");
      if (!pair) continue;
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { redirect: "manual" });
  collect(csrfRes);
  const json = (await csrfRes.json().catch(() => ({}))) as { csrfToken?: string };
  if (!json.csrfToken) return "";

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie() },
    body: new URLSearchParams({
      kode,
      password,
      csrfToken: json.csrfToken,
      callbackUrl: `${BASE}/dashboard`,
    }),
    redirect: "manual",
  });
  collect(res);

  const jarAkhir = cookie();
  if (!/session-token/i.test(jarAkhir)) return "";
  return jarAkhir;
}

/** True kalau cookie hasil login benar-benar membawa token sesi. */
export function punyaSesi(jar: string): boolean {
  return /session-token/i.test(jar);
}

/** Fetch JSON dengan header cookie, selalu mengembalikan { status, body }. */
export async function jsonReq(
  jar: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: jar,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  };
}

/** Ambil password seed dari env — dipakai semua skrip uji HTTP. */
export function seedPassword(): string {
  const p = process.env.SEED_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!p) {
    throw new Error(
      "SEED_PASSWORD / SEED_ADMIN_PASSWORD belum di-set. Lihat prisma/seed.ts."
    );
  }
  return p;
}
